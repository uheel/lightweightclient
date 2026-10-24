import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Button, Checkbox, InputNumber, Tooltip } from "antd";
import { CopyOutlined, DeleteOutlined, RotateLeftOutlined, RotateRightOutlined } from "@ant-design/icons";
import type { PlanElement, RoomDesign } from "../../api/room";
import { newId } from "../radarSlot";
import { boundRect, radarInRoom, ZONE_COLOR, zoneRect, zonesOf, type QlConfig } from "../qinglan";
import { FURNITURE, FURNITURE_GROUPS, furnitureDef, furnitureOf, isDecor, isDoor, newFurniture, type FurnitureKind } from "./catalog";
import { FurnitureIcon, FurnitureShape } from "./icons";
import RoomBackdrop from "../RoomBackdrop";

/** 拖动、改尺寸按 5 cm 对齐；离墙这么近就贴上去 */
const GRID = 5;
const WALL_SNAP = 10;
const PAD = 60;
const MIN = 5;

type Pt = { x: number; y: number };

const snap = (v: number) => Math.round(v / GRID) * GRID;
const rad = (deg = 0) => (deg * Math.PI) / 180;
/** 元素局部坐标 → 房间坐标（平台的 rotation 以左上角为轴） */
const toWorld = (e: PlanElement, p: Pt): Pt => {
  const a = rad(e.rotation);
  return { x: (e.x ?? 0) + p.x * Math.cos(a) - p.y * Math.sin(a), y: (e.y ?? 0) + p.x * Math.sin(a) + p.y * Math.cos(a) };
};
const toLocal = (e: PlanElement, p: Pt): Pt => {
  const a = -rad(e.rotation);
  const dx = p.x - (e.x ?? 0);
  const dy = p.y - (e.y ?? 0);
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
};
const sizeOf = (e: PlanElement) => ({ w: e.width ?? 0, h: e.height ?? 0 });
function aabb(e: PlanElement) {
  const { w, h } = sizeOf(e);
  const ps = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ].map((p) => toWorld(e, p));
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
const centerOf = (e: PlanElement) => toWorld(e, { x: sizeOf(e).w / 2, y: sizeOf(e).h / 2 });
/** 左上角放到 (x, y)：对齐网格，离墙近的贴墙 */
function placeAt(e: PlanElement, x: number, y: number, room: { width: number; height: number }): PlanElement {
  const n = { ...e, x: snap(x), y: snap(y) };
  const b = aabb(n);
  let dx = 0;
  let dy = 0;
  if (Math.abs(b.x0) <= WALL_SNAP) dx = -b.x0;
  else if (Math.abs(room.width - b.x1) <= WALL_SNAP) dx = room.width - b.x1;
  if (Math.abs(b.y0) <= WALL_SNAP) dy = -b.y0;
  else if (Math.abs(room.height - b.y1) <= WALL_SNAP) dy = room.height - b.y1;
  return { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) };
}
/** 绕中心转到 deg 度 */
function rotateTo(e: PlanElement, deg: number): PlanElement {
  const c = centerOf(e);
  const r = ((Math.round(deg) % 360) + 360) % 360;
  const { w, h } = sizeOf(e);
  const a = rad(r);
  const ox = (w / 2) * Math.cos(a) - (h / 2) * Math.sin(a);
  const oy = (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a);
  return { ...e, rotation: r, x: Math.round(c.x - ox), y: Math.round(c.y - oy) };
}
type Drag = { id: string; mode: "move" | "resize"; start: Pt; orig: PlanElement };

/**
 * 装修编辑器：在房间平面图上摆家具。只改布置里顶层的图片 / 矩形（家具），雷达、区域、文字不动。
 * 改动都在本地，点保存才写平台（onSave），不下发设备
 */
export default function FurnitureEditor({
  design,
  size,
  radars,
  saving,
  onChange,
}: {
  design?: RoomDesign;
  size: { width: number; height: number };
  radars: QlConfig[];
  saving?: boolean;
  /** 每次改动后的全部家具（顶层顺序），dirty 表示和打开时不一样 */
  onChange: (items: PlanElement[], dirty: boolean) => void;
}) {
  const room = size;
  const initial = useMemo(() => (design?.elements ?? []).filter(isDecor).map((e) => ({ ...e, id: e.id || newId() })), [design]);
  const [items, setItems] = useState<PlanElement[]>(initial);
  const [sel, setSel] = useState<string>();
  const [showZones, setShowZones] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);

  const update = (next: PlanElement[]) => {
    setItems(next);
    onChange(next, JSON.stringify(next) !== JSON.stringify(initial));
  };
  const patch = (id: string, f: (e: PlanElement) => PlanElement) => update(items.map((e) => (e.id === id ? f(e) : e)));
  const selected = items.find((e) => e.id === sel);

  const pointOf = (clientX: number, clientY: number): Pt => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  function add(kind: FurnitureKind, at?: Pt) {
    const def = furnitureDef(kind);
    const c = at ?? { x: room.width / 2, y: room.height / 2 };
    const e = newFurniture(def, newId(), c.x - def.width / 2, c.y - def.height / 2);
    const placed = placeAt(e, e.x ?? 0, e.y ?? 0, room);
    update([...items, placed]);
    setSel(placed.id);
    svgRef.current?.parentElement?.focus();
  }
  function duplicate(e: PlanElement) {
    const copy = placeAt({ ...e, id: newId() }, (e.x ?? 0) + 20, (e.y ?? 0) + 20, room);
    update([...items, copy]);
    setSel(copy.id);
  }
  function remove(id: string) {
    update(items.filter((e) => e.id !== id));
    setSel(undefined);
  }

  const onDown = (ev: PointerEvent, e: PlanElement, mode: Drag["mode"]) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    svgRef.current?.setPointerCapture(ev.pointerId);
    setSel(e.id);
    drag.current = { id: e.id!, mode, start: pointOf(ev.clientX, ev.clientY), orig: e };
  };
  const onMove = (ev: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pointOf(ev.clientX, ev.clientY);
    if (d.mode === "move") {
      patch(d.id, () => placeAt(d.orig, (d.orig.x ?? 0) + p.x - d.start.x, (d.orig.y ?? 0) + p.y - d.start.y, room));
    } else {
      const l = toLocal(d.orig, p);
      patch(d.id, (e) => ({ ...e, width: Math.max(MIN, snap(l.x)), height: Math.max(MIN, snap(l.y)) }));
    }
  };
  const onUp = () => {
    drag.current = null;
  };

  const onDrop = (ev: DragEvent) => {
    const kind = ev.dataTransfer.getData("text/furniture") as FurnitureKind;
    if (!kind) return;
    ev.preventDefault();
    add(kind, pointOf(ev.clientX, ev.clientY));
  };

  const onKey = (ev: KeyboardEvent) => {
    if ((ev.target as HTMLElement).tagName === "INPUT" || !selected) return;
    const step = ev.shiftKey ? 10 : 1;
    const nudge = (dx: number, dy: number) => patch(selected.id!, (e) => ({ ...e, x: (e.x ?? 0) + dx, y: (e.y ?? 0) + dy }));
    const k = ev.key;
    if (k === "Delete" || k === "Backspace") remove(selected.id!);
    else if (k === "ArrowLeft") nudge(-step, 0);
    else if (k === "ArrowRight") nudge(step, 0);
    else if (k === "ArrowUp") nudge(0, -step);
    else if (k === "ArrowDown") nudge(0, step);
    else if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "d") duplicate(selected);
    else if (k.toLowerCase() === "r") patch(selected.id!, (e) => rotateTo(e, (e.rotation ?? 0) + (ev.shiftKey ? -90 : 90)));
    else if (k === "Escape") setSel(undefined);
    else return;
    ev.preventDefault();
  };

  const itemShape = (e: PlanElement) => (
    <g key={e.id} className={`fur-item${e.id === sel ? " on" : ""}`} onPointerDown={(ev) => onDown(ev, e, "move")}>
      <FurnitureShape e={e} />
    </g>
  );

  const vb = `${-PAD} ${-PAD} ${room.width + PAD * 2} ${room.height + PAD * 2}`;
  const fs = Math.max(11, Math.round(Math.max(room.width, room.height) / 40));
  const selDef = selected && furnitureOf(selected);

  return (
    <div className="fur-editor" tabIndex={0} onKeyDown={onKey}>
      <aside className="fur-palette">
        {FURNITURE_GROUPS.map((g) => (
          <section key={g}>
            <h4>{g}</h4>
            <div className="fur-palette-grid">
              {FURNITURE.filter((f) => f.group === g).map((f) => (
                <button
                  key={f.kind}
                  type="button"
                  className="fur-tile"
                  title={`${f.label} ${f.width}×${f.height} cm，点一下放到房间中间，或拖到图上`}
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData("text/furniture", f.kind);
                    ev.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => add(f.kind)}
                >
                  <svg viewBox={`-6 -6 ${Math.max(f.width, f.height) + 12} ${Math.max(f.width, f.height) + 12}`} className="fur">
                    <g transform={`translate(${(Math.max(f.width, f.height) - f.width) / 2} ${(Math.max(f.width, f.height) - f.height) / 2})`}>
                      <FurnitureIcon kind={f.kind} w={f.width} h={f.height} />
                    </g>
                  </svg>
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </aside>

      <div className="fur-canvas" onDragOver={(ev) => ev.preventDefault()} onDrop={onDrop}>
        <svg
          ref={svgRef}
          viewBox={vb}
          preserveAspectRatio="xMidYMid meet"
          className="fur-svg"
          onPointerDown={() => setSel(undefined)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {/* 底图（网格、户型图、文字）和墙用公共组件；家具在这里自己画，才能拖 */}
          <RoomBackdrop size={room} roomStyle={design?.roomStyle} elements={(design?.elements ?? []).filter((e) => !isDecor(e))}>
            {showZones &&
              radars.map((c, i) => {
                const b = boundRect(c);
                const rd = radarInRoom(c);
                return (
                  <g key={i} className="fur-zones">
                    <rect x={b.x} y={b.y} width={b.width} height={b.height} className="plan-bound" />
                    {zonesOf(c).map((z) => {
                      const r = zoneRect(c, z);
                      const color = ZONE_COLOR[z.type] ?? "#999";
                      return <rect key={z.id ?? z.index} x={r.x} y={r.y} width={r.width} height={r.height} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={1} strokeDasharray="4 3" />;
                    })}
                    <circle cx={rd.x} cy={rd.y} r={fs * 0.4} className="plan-radar-lens" />
                  </g>
                );
              })}
            {items.filter((e) => !isDoor(e)).map(itemShape)}
          </RoomBackdrop>
          {/* 门画在墙和隔墙之后，门洞才能把墙挖开 */}
          {items.filter(isDoor).map(itemShape)}
          {selected && (
            <g transform={`translate(${selected.x ?? 0} ${selected.y ?? 0})${selected.rotation ? ` rotate(${selected.rotation})` : ""}`}>
              <rect x={0} y={0} width={selected.width ?? 0} height={selected.height ?? 0} className="fur-sel" />
              <rect
                x={(selected.width ?? 0) - fs * 0.45}
                y={(selected.height ?? 0) - fs * 0.45}
                width={fs * 0.9}
                height={fs * 0.9}
                className="fur-handle"
                onPointerDown={(ev) => onDown(ev, selected, "resize")}
              />
            </g>
          )}
        </svg>
        <div className="fur-canvas-foot muted small">
          <Checkbox checked={showZones} onChange={(e) => setShowZones(e.target.checked)}>
            显示雷达区域
          </Checkbox>
          <span>
            {room.width / 100} × {room.height / 100} m · {items.length} 件 · 拖动按 5 cm 对齐、靠墙自动贴上 · 方向键微调（Shift 10 cm）· R 旋转 · Ctrl+D 复制 · Delete 删除
          </span>
        </div>
      </div>

      <aside className="fur-props">
        {selected ? (
          <>
            <h4>{selDef?.label ?? (selected.type === 4 ? "平台图片" : "矩形")}</h4>
            {!selDef && <p className="muted small">平台网页端摆的，客户端没有对应图标，照原样显示</p>}
            <label>
              宽（左右）
              <InputNumber size="small" min={MIN} max={2000} step={GRID} value={selected.width} suffix="cm" onChange={(v) => v && patch(selected.id!, (e) => ({ ...e, width: Math.round(v) }))} />
            </label>
            <label>
              长（上下）
              <InputNumber size="small" min={MIN} max={2000} step={GRID} value={selected.height} suffix="cm" onChange={(v) => v && patch(selected.id!, (e) => ({ ...e, height: Math.round(v) }))} />
            </label>
            <label>
              角度
              <span className="fur-rot">
                <Tooltip title="逆时针转 90°（Shift+R）">
                  <Button size="small" icon={<RotateLeftOutlined />} onClick={() => patch(selected.id!, (e) => rotateTo(e, (e.rotation ?? 0) - 90))} />
                </Tooltip>
                <span>{selected.rotation ?? 0}°</span>
                <Tooltip title="顺时针转 90°（R）">
                  <Button size="small" icon={<RotateRightOutlined />} onClick={() => patch(selected.id!, (e) => rotateTo(e, (e.rotation ?? 0) + 90))} />
                </Tooltip>
              </span>
            </label>
            <div className="fur-prop-actions">
              <Button size="small" icon={<CopyOutlined />} onClick={() => duplicate(selected)}>
                复制
              </Button>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(selected.id!)}>
                删除
              </Button>
            </div>
          </>
        ) : (
          <p className="muted small">
            从左边点一件家具放进房间，或者直接拖到图上。点图上的家具可以拖动、拖右下角的小方块改大小。
            <br />
            <br />
            装修只是给平面图看的，保存后平台网页端也能看到，不会下发到设备。
          </p>
        )}
        {saving && <p className="muted small">保存中…</p>}
      </aside>
    </div>
  );
}

/** 保存装修：重新取最新布置，只换掉顶层的家具（放在最前面，画在雷达和区域下面），其他元素原样保留 */
export function mergeFurniture(fresh: RoomDesign | undefined, items: PlanElement[]): PlanElement[] {
  const others = (fresh?.elements ?? []).filter((e) => !isDecor(e));
  const clean = items.map((e) => ({
    ...e,
    x: Math.round(e.x ?? 0),
    y: Math.round(e.y ?? 0),
    width: Math.round(e.width ?? 0),
    height: Math.round(e.height ?? 0),
    rotation: (((Math.round(e.rotation ?? 0)) % 360) + 360) % 360,
  }));
  return [...clean, ...others];
}
