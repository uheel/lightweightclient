import { useRef, useState } from "react";
import { Button, Select } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";

/**
 * 区域画布：在平面图方向上拖动区域、拖边角改大小，监测范围也直接拖边。界面上不出现坐标数字。
 * 内部全部用设备坐标（分米，以雷达为原点）：设备只认这个，也正好是设备的精度（10 cm）。
 * 画的时候按房间平面图的方向转一下（和平台网页端、运维端"房间"页一致）。
 */

/** 设备坐标里的矩形，分米 */
export interface DmRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface CanvasZone extends DmRect {
  id: number;
  type: number;
}

export interface ZoneType {
  value: number;
  label: string;
  color: string;
  /** 新加时的大小（平面图上 宽 × 高，分米） */
  size: [number, number];
}

/** 设备坐标 → 平面图方向（y 向下），是平台 toRoom 的偏移部分 */
export function toPlan(installType: number, facing: number, x: number, y: number): [number, number] {
  if (installType === 1) return facing === 2 ? [-y, -x] : facing === 3 ? [x, -y] : facing === 4 ? [y, x] : [-x, y];
  return facing === 2 ? [y, x] : facing === 3 ? [-x, y] : facing === 4 ? [-y, -x] : [x, -y];
}

/** toPlan 的逆运算 */
export function fromPlan(installType: number, facing: number, X: number, Y: number): [number, number] {
  if (installType === 1) return facing === 2 ? [-Y, -X] : facing === 3 ? [X, -Y] : facing === 4 ? [Y, X] : [-X, Y];
  return facing === 2 ? [Y, X] : facing === 3 ? [-X, Y] : facing === 4 ? [-Y, -X] : [X, -Y];
}

/** 探测范围的上限（设备坐标）：容器尺寸按装法和模式查表，换到设备坐标后和朝向无关 */
export function limitOf(installType: number, mode: number): DmRect {
  if (installType !== 1) return { x0: -30, x1: 30, y0: -20, y1: 20 };
  if (mode === 3) return { x0: -40, x1: 40, y0: 0, y1: 60 };
  if (mode === 11) return { x0: -6, x1: 6, y0: 0, y1: 20 };
  return { x0: -30, x1: 30, y0: 0, y1: 40 };
}

type EdgeX = "x0" | "x1";
type EdgeY = "y0" | "y1";
/** 拖的是哪条边 / 哪个角（用设备坐标的边表示） */
interface Grip {
  x?: EdgeX;
  y?: EdgeY;
}

type Target = { kind: "zone"; index: number } | { kind: "bound" };

interface Drag {
  target: Target;
  grip?: Grip;
  /** 按下时指针在平面图上的位置 */
  start: [number, number];
  /** 按下时的矩形 */
  rect: DmRect;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmtM = (dm: number) => (dm / 10).toFixed(1).replace(/\.0$/, "");

/** 矩形移动 dx/dy 后限制在 lim 里，大小不变 */
function moveInside(r: DmRect, dx: number, dy: number, lim: DmRect): DmRect {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const x0 = clamp(r.x0 + dx, lim.x0, lim.x1 - w);
  const y0 = clamp(r.y0 + dy, lim.y0, lim.y1 - h);
  return { x0, x1: x0 + w, y0, y1: y0 + h };
}

/** 拖边 / 角：把对应的边移到 (x, y)，至少 1 分米宽，限制在 lim 里 */
function resizeInside(r: DmRect, g: Grip, x: number, y: number, lim: DmRect): DmRect {
  const n = { ...r };
  if (g.x === "x0") n.x0 = clamp(x, lim.x0, r.x1 - 1);
  if (g.x === "x1") n.x1 = clamp(x, r.x0 + 1, lim.x1);
  if (g.y === "y0") n.y0 = clamp(y, lim.y0, r.y1 - 1);
  if (g.y === "y1") n.y1 = clamp(y, r.y0 + 1, lim.y1);
  return n;
}

const GRIPS: Grip[] = [{ x: "x0" }, { x: "x1" }, { y: "y0" }, { y: "y1" }, { x: "x0", y: "y0" }, { x: "x1", y: "y0" }, { x: "x0", y: "y1" }, { x: "x1", y: "y1" }];

export default function ZoneCanvas({
  installType,
  facing,
  bound,
  limit,
  zones,
  room,
  types,
  disabled,
  onZones,
  onBound,
}: {
  installType: number;
  facing: number;
  /** 监测范围；没有安装配置时为空 */
  bound?: DmRect;
  /** 探测范围上限 */
  limit: DmRect;
  zones: CanvasZone[];
  /** 房间外框（cm，平面图坐标）和雷达在房间里的位置；不在房间布置里时没有 */
  room?: { width: number; height: number; radar: { x: number; y: number } };
  types: ZoneType[];
  disabled?: boolean;
  onZones: (z: CanvasZone[]) => void;
  onBound?: (b: DmRect) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<Target>();
  // 拖动状态放在 ref 里：快速拖动时 pointermove 可能比重新渲染先到，读 state 会丢掉这些移动
  const dragRef = useRef<Drag>(undefined);
  const [dragging, setDragging] = useState(false);
  const P = (x: number, y: number) => toPlan(installType, facing, x, y);
  const planRect = (r: DmRect) => {
    const [ax, ay] = P(r.x0, r.y0);
    const [bx, by] = P(r.x1, r.y1);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  };
  const typeOf = (t: number) => types.find((x) => x.value === t);
  const zoneLimit = (z: { type: number }) => (z.type === 3 ? limit : bound ?? limit);

  // 视图范围：探测上限、房间、所有区域
  const roomRect = room && { x: -room.radar.x / 10, y: -room.radar.y / 10, w: room.width / 10, h: room.height / 10 };
  const all = [planRect(limit), ...(roomRect ? [roomRect] : []), ...zones.map(planRect)];
  const pad = 4;
  const vx = Math.min(...all.map((r) => r.x)) - pad;
  const vy = Math.min(...all.map((r) => r.y)) - pad;
  const vw = Math.max(...all.map((r) => r.x + r.w)) + pad - vx;
  const vh = Math.max(...all.map((r) => r.y + r.h)) + pad - vy;
  const fs = Math.max(vw, vh) / 42;

  /** 指针位置 → 平面图坐标（分米） */
  function planPoint(e: React.PointerEvent): [number, number] {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }

  function begin(e: React.PointerEvent, target: Target, grip?: Grip) {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setSel(target);
    const rect = target.kind === "zone" ? zones[target.index]! : bound!;
    dragRef.current = { target, grip, start: planPoint(e), rect };
    setDragging(true);
  }

  function move(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const [px, py] = planPoint(e);
    if (drag.target.kind === "bound") {
      if (!drag.grip || !onBound) return;
      const [dx, dy] = fromPlan(installType, facing, px, py);
      const b = resizeInside(drag.rect, drag.grip, Math.round(dx), Math.round(dy), limit);
      if (JSON.stringify(b) !== JSON.stringify(bound)) onBound(b);
      return;
    }
    const i = drag.target.index;
    const z = zones[i]!;
    let r: DmRect;
    if (drag.grip) {
      const [dx, dy] = fromPlan(installType, facing, px, py);
      r = resizeInside(drag.rect, drag.grip, Math.round(dx), Math.round(dy), zoneLimit(z));
    } else {
      // 平面图上的位移换成设备坐标的位移（只有旋转 / 镜像，没有平移）
      const [mx, my] = fromPlan(installType, facing, px - drag.start[0], py - drag.start[1]);
      r = moveInside(drag.rect, Math.round(mx), Math.round(my), zoneLimit(z));
    }
    if (r.x0 !== z.x0 || r.x1 !== z.x1 || r.y0 !== z.y0 || r.y1 !== z.y1) onZones(zones.map((q, j) => (j === i ? { ...q, ...r } : q)));
  }

  function end() {
    dragRef.current = undefined;
    setDragging(false);
  }

  function add(t: ZoneType) {
    let id = 0;
    while (zones.some((z) => z.id === id)) id++;
    // 平面图上的宽高换成设备坐标的宽高，放在监测范围中间
    const [a, b] = fromPlan(installType, facing, t.size[0], t.size[1]);
    const w = Math.abs(a);
    const h = Math.abs(b);
    const lim = zoneLimit({ type: t.value });
    const cx = Math.round((lim.x0 + lim.x1) / 2 - w / 2);
    const cy = Math.round((lim.y0 + lim.y1) / 2 - h / 2);
    const r = moveInside({ x0: cx, x1: cx + w, y0: cy, y1: cy + h }, 0, 0, lim);
    const next = [...zones, { id, type: t.value, ...r }];
    onZones(next);
    setSel({ kind: "zone", index: next.length - 1 });
  }

  function remove(i: number) {
    onZones(zones.filter((_, j) => j !== i));
    setSel(undefined);
  }

  function onKey(e: React.KeyboardEvent) {
    if (disabled || sel?.kind !== "zone") return;
    const z = zones[sel.index];
    if (!z) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return remove(sel.index);
    }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    const [mx, my] = fromPlan(installType, facing, step[0]!, step[1]!);
    const r = moveInside(z, mx, my, zoneLimit(z));
    onZones(zones.map((q, j) => (j === sel.index ? { ...q, ...r } : q)));
  }

  /** 一个矩形的拖柄：位置按设备的边算出来再换到平面图上 */
  function grips(r: DmRect, target: Target, allowed: (g: Grip) => boolean) {
    const mid = (a: number, b: number) => (a + b) / 2;
    return GRIPS.filter(allowed).map((g, k) => {
      const x = g.x ? r[g.x] : mid(r.x0, r.x1);
      const y = g.y ? r[g.y] : mid(r.y0, r.y1);
      const [X, Y] = P(x, y);
      const s = fs * 0.55;
      return <rect key={k} x={X - s / 2} y={Y - s / 2} width={s} height={s} className="zc-grip" onPointerDown={(e) => begin(e, target, g)} />;
    });
  }

  const selZone = sel?.kind === "zone" ? zones[sel.index] : undefined;
  const pb = bound && planRect(bound);
  const lim = planRect(limit);
  const boundGrip = (g: Grip) => !g.x !== !g.y && !(g.y === "y0" && installType === 1);

  return (
    <div className="zc">
      <div className="zc-tools">
        {types.map((t) => (
          <Button key={t.value} size="small" icon={<PlusOutlined />} disabled={disabled || (t.value === 5 && zones.some((z) => z.type === 5)) || zones.length >= 16} onClick={() => add(t)}>
            <i className="zc-dot" style={{ background: t.color }} />
            {t.label}
          </Button>
        ))}
      </div>
      <div className="zc-stage" tabIndex={0} onKeyDown={onKey}>
        <svg
          ref={svgRef}
          viewBox={`${vx} ${vy} ${vw} ${vh}`}
          preserveAspectRatio="xMidYMid meet"
          className={dragging ? "dragging" : ""}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerDown={() => setSel(undefined)}
          role="application"
          aria-label="区域画布"
        >
          <defs>
            <pattern id="zc-grid" x={0} y={0} width={10} height={10} patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#E6E8F0" strokeWidth={0.15} />
            </pattern>
          </defs>
          <rect x={vx} y={vy} width={vw} height={vh} fill="url(#zc-grid)" />
          <rect x={lim.x} y={lim.y} width={lim.w} height={lim.h} className="zc-limit" />
          {roomRect && <rect x={roomRect.x} y={roomRect.y} width={roomRect.w} height={roomRect.h} className="zc-room" />}
          {pb && (
            <g>
              <rect
                x={pb.x}
                y={pb.y}
                width={pb.w}
                height={pb.h}
                className={`zc-bound${sel?.kind === "bound" ? " on" : ""}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSel({ kind: "bound" });
                }}
              />
              {onBound && !disabled && sel?.kind === "bound" && grips(bound!, { kind: "bound" }, boundGrip)}
            </g>
          )}
          {zones.map((z, i) => {
            const r = planRect(z);
            const t = typeOf(z.type);
            const on = sel?.kind === "zone" && sel.index === i;
            return (
              <g key={i}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={Math.max(r.w, 0.3)}
                  height={Math.max(r.h, 0.3)}
                  fill={t?.color ?? "#999"}
                  fillOpacity={z.type === 3 ? 0.12 : 0.28}
                  stroke={t?.color ?? "#999"}
                  strokeWidth={on ? fs * 0.18 : fs * 0.08}
                  strokeDasharray={z.type === 3 ? `${fs * 0.4} ${fs * 0.3}` : undefined}
                  className="zc-zone"
                  onPointerDown={(e) => begin(e, { kind: "zone", index: i })}
                />
                <text x={r.x + fs * 0.3} y={r.y + (r.h > fs * 1.6 ? fs * 1.1 : -fs * 0.35)} fontSize={fs} className="zc-label" fill={t?.color ?? "#666"}>
                  {z.id} {t?.label ?? `类型 ${z.type}`}
                </text>
              </g>
            );
          })}
          {selZone && !disabled && grips(selZone, sel!, () => true)}
          {(() => {
            // 箭头：设备正前方（设备坐标 y 增大的方向）在平面图上指向哪
            const [ax, ay] = P(0, fs * 1.8);
            return <line x1={0} y1={0} x2={ax} y2={ay} className="zc-look" />;
          })()}
          <circle cx={0} cy={0} r={fs * 0.5} className="zc-radar" />
          {(() => {
            const [lx, ly] = installType === 1 ? P(0, -1) : [0, 1];
            return (
              <text x={lx * fs * 1.2} y={ly * fs * 1.2 + fs * 0.35} fontSize={fs} textAnchor="middle" className="zc-radar-text">
                雷达
              </text>
            );
          })()}
        </svg>
      </div>
      <div className="zc-info">
        {selZone ? (
          <>
            <i className="zc-dot" style={{ background: typeOf(selZone.type)?.color ?? "#999" }} />
            <Select
              size="small"
              value={selZone.type}
              disabled={disabled}
              popupMatchSelectWidth={false}
              options={types.map((t) => ({ value: t.value, label: t.label, disabled: t.value === 5 && selZone.type !== 5 && zones.some((z) => z.type === 5) }))}
              onChange={(v: number) => onZones(zones.map((q, j) => (sel?.kind === "zone" && j === sel.index ? { ...q, type: v } : q)))}
            />
            <span className="zc-id" title="场景规则里用这个编号引用区域">
              编号 {selZone.id}
            </span>
            <span>
              {fmtM(planRect(selZone).w)} × {fmtM(planRect(selZone).h)} 米
            </span>
            <span className="grow" />
            <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={disabled} onClick={() => sel?.kind === "zone" && remove(sel.index)}>
              删除
            </Button>
          </>
        ) : sel?.kind === "bound" && pb ? (
          <span>
            监测范围 {fmtM(pb.w)} × {fmtM(pb.h)} 米
            {onBound && !disabled ? "，拖边调整" : ""}
          </span>
        ) : (
          <span className="muted">拖动区域移动，选中后拖边角调大小，方向键微调 10 厘米；点虚线框可以调监测范围。</span>
        )}
      </div>
    </div>
  );
}
