import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Button, Checkbox, InputNumber, Tooltip } from "antd";
import { CopyOutlined, DeleteOutlined, RotateLeftOutlined, RotateRightOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import type { PlanElement, RoomDesign } from "../../api/room";
import { newId } from "../radarSlot";
import { boundRect, radarInRoom, ZONE_COLOR, zoneRect, zonesOf, type QlConfig } from "../qinglan";
import { FURNITURE, FURNITURE_GROUPS, furnitureDef, furnitureOf, isDecor, isDoor, newFurniture, type FurnitureKind } from "./catalog";
import { FurnitureIcon, FurnitureShape } from "./icons";
import RoomBackdrop from "../RoomBackdrop";
import "./furniture.css";

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
type Box = { x: number; y: number; w: number; h: number };
type Rect = { x0: number; y0: number; x1: number; y1: number };
/** 最多放大到 10 倍，最多缩小到 1.5 倍大小 */
const MAX_IN = 10;
const MAX_OUT = 1.5;

/**
 * 选中家具四个方向的标注：到最近的墙或家具（这个方向上、和它有重叠那段的另一件）的距离，cm。
 * 已经贴上（距离不到 1 cm）的方向不标
 */
function dimensionsOf(b: Rect, others: Rect[], room: { width: number; height: number }) {
  const overlapY = (o: Rect) => o.y0 < b.y1 && o.y1 > b.y0;
  const overlapX = (o: Rect) => o.x0 < b.x1 && o.x1 > b.x0;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const left = Math.max(0, ...others.filter((o) => overlapY(o) && o.x1 <= b.x0).map((o) => o.x1));
  const right = Math.min(room.width, ...others.filter((o) => overlapY(o) && o.x0 >= b.x1).map((o) => o.x0));
  const top = Math.max(0, ...others.filter((o) => overlapX(o) && o.y1 <= b.y0).map((o) => o.y1));
  const bottom = Math.min(room.height, ...others.filter((o) => overlapX(o) && o.y0 >= b.y1).map((o) => o.y0));
  return [
    { x1: left, y1: cy, x2: b.x0, y2: cy },
    { x1: b.x1, y1: cy, x2: right, y2: cy },
    { x1: cx, y1: top, x2: cx, y2: b.y0 },
    { x1: cx, y1: b.y1, x2: cx, y2: bottom },
  ].filter((d) => Math.hypot(d.x2 - d.x1, d.y2 - d.y1) >= 1);
}

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
  // 缩放 / 平移：改 viewBox；null 时是整间房（适应）
  const base: Box = { x: -PAD, y: -PAD, w: room.width + PAD * 2, h: room.height + PAD * 2 };
  const [zoom, setZoom] = useState<Box | null>(null);
  const v = zoom ?? base;
  const baseRef = useRef(base);
  baseRef.current = base;
  /** 拖空白处平移：按下时的视图和指针；没挪动就松手算点空白（取消选中） */
  const pan = useRef<{ x: number; y: number; v: Box; scale: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  /** 以 at（屏幕坐标，不给就是画布中心）为中心缩放：k < 1 放大 */
  const zoomBy = (k: number, at?: { x: number; y: number }) => {
    const el = svgRef.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return;
    const r = el.getBoundingClientRect();
    const p = new DOMPoint(at?.x ?? r.x + r.width / 2, at?.y ?? r.y + r.height / 2).matrixTransform(ctm.inverse());
    setZoom((cur) => {
      const b = baseRef.current;
      const c = cur ?? b;
      const w = Math.min(b.w * MAX_OUT, Math.max(b.w / MAX_IN, c.w * k));
      const f = w / c.w;
      return { x: p.x - (p.x - c.x) * f, y: p.y - (p.y - c.y) * f, w, h: c.h * f };
    });
  };
  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;
  // 画布在屏幕上的大小：标注文字、手柄按屏幕像素定大小，窗口多大、放大多少倍都一样清楚
  const [px, setPx] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPx({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 滚轮要 preventDefault（不然弹窗跟着滚），React 的 onWheel 是 passive 的，只能自己挂
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current(Math.exp(e.deltaY * 0.0015), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

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
  const onBgDown = (ev: PointerEvent<SVGSVGElement>) => {
    if (ev.button !== 0) return;
    const ctm = ev.currentTarget.getScreenCTM();
    if (!ctm) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    pan.current = { x: ev.clientX, y: ev.clientY, v, scale: ctm.a, moved: false };
  };
  const onMove = (ev: PointerEvent) => {
    const pn = pan.current;
    if (pn) {
      // 挪动不到 3 像素算点击，不平移
      if (!pn.moved && Math.hypot(ev.clientX - pn.x, ev.clientY - pn.y) < 3) return;
      if (!pn.moved) setPanning(true);
      pn.moved = true;
      setZoom({ ...pn.v, x: pn.v.x - (ev.clientX - pn.x) / pn.scale, y: pn.v.y - (ev.clientY - pn.y) / pn.scale });
      return;
    }
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
    if (pan.current && !pan.current.moved) setSel(undefined);
    pan.current = null;
    setPanning(false);
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

  const vb = `${v.x} ${v.y} ${v.w} ${v.h}`;
  // 文字、手柄按房间大小定，放大后跟着缩小，屏幕上保持一样大
  const fs = Math.max(11, Math.round(Math.max(room.width, room.height) / 40)) * (v.w / base.w);
  /** 一个屏幕像素是多少房间单位（cm） */
  const upp = px.w && px.h ? 1 / Math.min(px.w / v.w, px.h / v.h) : fs / 12;
  const selDef = selected && furnitureOf(selected);
  const selBox = selected && aabb(selected);
  const dims = selBox ? dimensionsOf(selBox, items.filter((e) => e.id !== sel && !isDoor(e)).map(aabb), room) : [];
  /** 选中家具的外接框移到离左墙 / 上墙 to cm */
  const moveBoxTo = (axis: "x" | "y", to: number) => {
    if (!selected || !selBox) return;
    const from = axis === "x" ? selBox.x0 : selBox.y0;
    patch(selected.id!, (e) => ({ ...e, [axis]: Math.round((e[axis] ?? 0) + to - from) }));
  };

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
          className={`fur-svg${panning ? " panning" : ""}`}
          onPointerDown={onBgDown}
          onDoubleClick={(ev) => !(ev.target as Element).closest(".fur-item, .fur-handle") && setZoom(null)}
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
                x={(selected.width ?? 0) - upp * 5}
                y={(selected.height ?? 0) - upp * 5}
                width={upp * 10}
                height={upp * 10}
                className="fur-handle"
                onPointerDown={(ev) => onDown(ev, selected, "resize")}
              />
            </g>
          )}
          {/* 位置标注：到四边最近的墙或家具的距离 */}
          {dims.map((d, i) => {
            const horiz = d.y1 === d.y2;
            const t = upp * 4;
            return (
              <g key={i} className="fur-dim">
                <line x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} />
                {horiz ? (
                  <>
                    <line x1={d.x1} y1={d.y1 - t} x2={d.x1} y2={d.y1 + t} />
                    <line x1={d.x2} y1={d.y2 - t} x2={d.x2} y2={d.y2 + t} />
                  </>
                ) : (
                  <>
                    <line x1={d.x1 - t} y1={d.y1} x2={d.x1 + t} y2={d.y1} />
                    <line x1={d.x2 - t} y1={d.y2} x2={d.x2 + t} y2={d.y2} />
                  </>
                )}
                <text
                  x={(d.x1 + d.x2) / 2 + (horiz ? 0 : upp * 5)}
                  y={(d.y1 + d.y2) / 2 + (horiz ? -upp * 5 : upp * 4)}
                  fontSize={upp * 12}
                  strokeWidth={upp * 3}
                  textAnchor={horiz ? "middle" : "start"}
                >
                  {Math.round(Math.hypot(d.x2 - d.x1, d.y2 - d.y1))}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="fur-canvas-foot muted small">
          <span className="fur-zoom">
            <Button size="small" type="text" icon={<ZoomOutOutlined />} title="缩小" onClick={() => zoomBy(1.25)} />
            <span className="fur-zoom-pct">{Math.round((base.w / v.w) * 100)}%</span>
            <Button size="small" type="text" icon={<ZoomInOutlined />} title="放大" onClick={() => zoomBy(0.8)} />
            <Button size="small" type="text" onClick={() => setZoom(null)} disabled={!zoom} title="看整间房（双击空白处也行）">
              适应
            </Button>
          </span>
          <Checkbox checked={showZones} onChange={(e) => setShowZones(e.target.checked)}>
            显示雷达区域
          </Checkbox>
          <span>
            {room.width / 100} × {room.height / 100} m · {items.length} 件 · 滚轮缩放、拖空白处平移 · 选中后标出到墙 / 家具的距离（cm）· 拖动按 5 cm 对齐、靠墙自动贴上 · 方向键微调（Shift 10 cm）· R 旋转 · Ctrl+D 复制 · Delete 删除
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
            {selBox && (
              <div className="fur-pos">
                <label>
                  离左墙
                  <InputNumber size="small" min={0} max={room.width} step={GRID} value={Math.round(selBox.x0)} suffix="cm" onChange={(n) => n !== null && moveBoxTo("x", n)} />
                </label>
                <label>
                  离上墙
                  <InputNumber size="small" min={0} max={room.height} step={GRID} value={Math.round(selBox.y0)} suffix="cm" onChange={(n) => n !== null && moveBoxTo("y", n)} />
                </label>
                <span className="muted small">
                  离右墙 {Math.round(room.width - selBox.x1)} · 离下墙 {Math.round(room.height - selBox.y1)} cm
                </span>
              </div>
            )}
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
