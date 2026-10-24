import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { PlanElement, RoomDesign } from "../api/room";
import RoomBackdrop from "./RoomBackdrop";
import { boundRect, containerRect, facingOf, mountOf, radarInRoom, supervisionRect, ZONE_COLOR, ZONE_TYPE, zoneRect, zonesOf, type QlConfig, type QlRect } from "./qinglan";

export interface PlanRadar {
  sn: string;
  label: string;
  config?: QlConfig;
  /** 没有区域配置时雷达画在元素自己的位置 */
  element?: PlanElement;
}

const PAD = 30;

function union(rects: QlRect[]) {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** 雷达"看"的方向（平面图坐标）：侧装朝上 = 装在上边、往下看 */
function lookDir(c: QlConfig) {
  const f = facingOf(c);
  if (mountOf(c) === 1) return ({ 1: [0, 1], 2: [-1, 0], 3: [0, -1], 4: [1, 0] } as const)[f];
  return undefined;
}

/** 房间平面图：房间外框、底图和家具、每台雷达的监测边界、监护区、区域（标区域 ID） */
export default function RoomPlan({
  design,
  size,
  radars,
  focusSn,
  focusZone,
  className,
  zoomable,
  showZones = true,
  children,
}: {
  design?: RoomDesign;
  size: { width: number; height: number };
  radars: PlanRadar[];
  focusSn?: string;
  focusZone?: number;
  className?: string;
  /** 滚轮缩放（以鼠标位置为中心）、拖动平移、双击复位 */
  zoomable?: boolean;
  /** 画雷达的监测边界、探测范围、监护区和区域；关掉时只剩房间、家具、雷达和叠加内容 */
  showZones?: boolean;
  /**
   * 叠加在最上层的内容（房间坐标，1 = 1 cm），例如监控模式的实时目标。
   * 传函数时拿到当前的文字大小（缩放后文字保持屏幕上一样大）
   */
  children?: ReactNode | ((fs: number) => ReactNode);
}) {
  const room = { x: 0, y: 0, ...size };
  const view = union([room, ...radars.flatMap((r) => (r.config ? [boundRect(r.config)] : []))]);
  const base = { x: view.x - PAD, y: view.y - PAD, w: view.width + PAD * 2, h: view.height + PAD * 2 };
  const { v, svgRef, contentRef, panning, onPointerDown, onPointerMove, onPointerUp, reset } = useZoom(base, zoomable);
  const vb = `${v.x} ${v.y} ${v.w} ${v.h}`;
  // 文字大小跟着图的尺寸走，保证缩放后还看得清；放大后按比例缩小，屏幕上保持一样大
  const fs = Math.max(11, Math.round(Math.max(view.width, view.height) / 34)) * (v.w / base.w);

  // 房间、家具、雷达、区域不随实时目标变：同一个元素对象 React 会整棵跳过，目标每 0.1 秒刷新时不用重画这些
  const staticLayer = useMemo(
    () => (
      <>
      <RoomBackdrop size={size} roomStyle={design?.roomStyle} elements={design?.elements} />

      {radars.map((r) => {
        const c = r.config;
        const dim = focusSn !== undefined && focusSn !== r.sn;
        if (!c) {
          const x = r.element?.x ?? 0;
          const y = r.element?.y ?? 0;
          return (
            <g key={r.sn} opacity={dim ? 0.35 : 1}>
              <RadarMark x={x} y={y} fs={fs} missing />
              <text x={x} y={y - fs} textAnchor="middle" fontSize={fs} className="plan-label">
                {r.label}（未配置）
              </text>
            </g>
          );
        }
        const cont = containerRect(c);
        const b = boundRect(c);
        const sup = supervisionRect(c);
        const rd = radarInRoom(c);
        const look = lookDir(c);
        const hasBed = zonesOf(c).some((z) => z.type === 5);
        return (
          <g key={r.sn} opacity={dim ? 0.35 : 1}>
            {showZones && <rect x={cont.x} y={cont.y} width={cont.width} height={cont.height} className="plan-container" />}
            {showZones && <rect x={b.x} y={b.y} width={b.width} height={b.height} className="plan-bound" />}
            {showZones && hasBed && <rect x={sup.x} y={sup.y} width={sup.width} height={sup.height} className="plan-supervision" />}
            {(showZones ? zonesOf(c) : []).map((z) => {
              const zr = zoneRect(c, z);
              const color = ZONE_COLOR[z.type] ?? "#999";
              const focused = focusZone === z.index && (focusSn === undefined || focusSn === r.sn);
              return (
                <g key={z.id ?? z.index}>
                  <rect x={zr.x} y={zr.y} width={Math.max(zr.width, 2)} height={Math.max(zr.height, 2)} fill={color} fillOpacity={z.type === 3 ? 0.12 : 0.22} stroke={color} strokeWidth={focused ? 4 : 1.5} strokeDasharray={z.type === 3 ? "6 4" : undefined} />
                  <text x={zr.x + 4} y={zr.y + (zr.height < fs * 1.4 ? -4 : fs + 2)} fontSize={fs} className="plan-zone-text" fill={color}>
                    {z.index} · {z.text || ZONE_TYPE[z.type] || `类型 ${z.type}`}
                  </text>
                </g>
              );
            })}
            {look && <line x1={rd.x} y1={rd.y} x2={rd.x + look[0] * fs * 2.2} y2={rd.y + look[1] * fs * 2.2} className="plan-look" />}
            <RadarMark x={rd.x} y={rd.y} fs={fs} />
            <text x={rd.x} y={rd.y + (look && look[1] > 0 ? -fs * 0.9 : fs * 1.6)} textAnchor="middle" fontSize={fs} className="plan-label">
              {r.label}
            </text>
          </g>
        );
      })}
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design, size.width, size.height, radars, focusSn, focusZone, fs, showZones],
  );

  return (
    <svg
      ref={svgRef}
      className={`room-plan${className ? ` ${className}` : ""}${zoomable ? " zoomable" : ""}${panning ? " panning" : ""}`}
      viewBox={vb}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="房间平面图"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
    >
      {/* 拖动时直接改这个 g 的 transform（不经过 React），松手再写回 viewBox */}
      <g ref={contentRef}>
        {staticLayer}
        {typeof children === "function" ? children(fs) : children}
      </g>
    </svg>
  );
}

/** 雷达画成圆角方块（设备外壳）+ 中间小圆（镜头），灰色空心；实时目标是实心彩色圆点，两者一眼能分开 */
function RadarMark({ x, y, fs, missing }: { x: number; y: number; fs: number; missing?: boolean }) {
  const s = fs * 1.1;
  return (
    <g className={`plan-radar${missing ? " missing" : ""}`}>
      <rect x={x - s / 2} y={y - s / 2} width={s} height={s} rx={s * 0.22} className="plan-radar-box" />
      <circle cx={x} cy={y} r={s * 0.2} className="plan-radar-lens" />
    </g>
  );
}

type Box = { x: number; y: number; w: number; h: number };
/** 最多放大到原来的 12 倍，最多缩小到 1.5 倍大小 */
const MAX_IN = 12;
const MAX_OUT = 1.5;

/**
 * 平面图缩放 / 平移：viewBox 在 base 基础上变化；base 变了（换房间、布置变了）就复位。
 * 拖动时每帧最多改一次内容 g 的 transform，不触发 React 渲染（高回报率鼠标一秒几百个 move 事件）；松手才写回 viewBox。
 * 滚轮同样攒到下一帧一起算
 */
function useZoom(base: Box, enabled?: boolean) {
  const [zoom, setZoom] = useState<Box | null>(null);
  const [panning, setPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const drag = useRef<{ x: number; y: number; v: Box; scale: number; dx: number; dy: number; raf: number } | null>(null);
  const baseKey = `${base.x},${base.y},${base.w},${base.h}`;
  const baseRef = useRef(base);
  baseRef.current = base;

  useEffect(() => setZoom(null), [baseKey]);

  useEffect(() => {
    const el = svgRef.current;
    if (!enabled || !el) return;
    let pending = 0;
    let at = { x: 0, y: 0 };
    let raf = 0;
    const apply = () => {
      raf = 0;
      const ctm = el.getScreenCTM();
      const dy = pending;
      pending = 0;
      if (!ctm) return;
      const p = new DOMPoint(at.x, at.y).matrixTransform(ctm.inverse());
      const b = baseRef.current;
      setZoom((cur) => {
        const v = cur ?? b;
        const w = Math.min(b.w * MAX_OUT, Math.max(b.w / MAX_IN, v.w * Math.exp(dy * 0.0015)));
        const k = w / v.w;
        return { x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w, h: v.h * k };
      });
    };
    // 滚轮要 preventDefault（不然外层跟着滚），React 的 onWheel 是 passive 的，只能自己挂
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (drag.current) return;
      pending += e.deltaY;
      at = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(apply);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);

  const v = (enabled && zoom) || base;
  const end = () => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    // 先同步写回 viewBox 再去掉临时 transform，中间不会闪回原位
    flushSync(() => {
      if (d.dx || d.dy) setZoom({ ...d.v, x: d.v.x - d.dx, y: d.v.y - d.dy });
      setPanning(false);
    });
    contentRef.current?.removeAttribute("transform");
  };
  return {
    v,
    svgRef,
    contentRef,
    panning,
    onPointerDown: (e: PointerEvent<SVGSVGElement>) => {
      if (!enabled || e.button !== 0) return;
      const ctm = e.currentTarget.getScreenCTM();
      if (!ctm) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, v, scale: ctm.a, dx: 0, dy: 0, raf: 0 };
      setPanning(true);
    },
    onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      if (!d) return;
      d.dx = (e.clientX - d.x) / d.scale;
      d.dy = (e.clientY - d.y) / d.scale;
      if (!d.raf)
        d.raf = requestAnimationFrame(() => {
          d.raf = 0;
          contentRef.current?.setAttribute("transform", `translate(${d.dx} ${d.dy})`);
        });
    },
    onPointerUp: end,
    reset: () => enabled && setZoom(null),
  };
}
