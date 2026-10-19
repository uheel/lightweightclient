import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { assetUrl } from "@radar/core";
import type { PlanElement, RoomDesign } from "../api/room";
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
  /**
   * 叠加在最上层的内容（房间坐标，1 = 1 cm），例如监控模式的实时目标。
   * 传函数时拿到当前的文字大小（缩放后文字保持屏幕上一样大）
   */
  children?: ReactNode | ((fs: number) => ReactNode);
}) {
  const room = { x: 0, y: 0, ...size };
  const view = union([room, ...radars.flatMap((r) => (r.config ? [boundRect(r.config)] : []))]);
  const base = { x: view.x - PAD, y: view.y - PAD, w: view.width + PAD * 2, h: view.height + PAD * 2 };
  const { v, svgRef, panning, onPointerDown, onPointerMove, onPointerUp, reset } = useZoom(base, zoomable);
  const vb = `${v.x} ${v.y} ${v.w} ${v.h}`;
  const bg = design?.roomStyle;
  const others = (design?.elements ?? []).filter((e) => e.type !== 3);
  // 文字大小跟着图的尺寸走，保证缩放后还看得清；放大后按比例缩小，屏幕上保持一样大
  const fs = Math.max(11, Math.round(Math.max(view.width, view.height) / 34)) * (v.w / base.w);

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
      <defs>
        <pattern id="plan-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#EEF0F5" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x={room.x} y={room.y} width={room.width} height={room.height} fill="url(#plan-grid)" />
      {bg?.type === 4 && bg.src && <image href={assetUrl(bg.src)} x={0} y={0} width={room.width} height={room.height} preserveAspectRatio="none" opacity={0.55} />}
      {others.map((e, i) => (
        <PlanShape key={e.id ?? i} e={e} />
      ))}
      <rect x={room.x} y={room.y} width={room.width} height={room.height} className="plan-room" />

      {radars.map((r) => {
        const c = r.config;
        const dim = focusSn !== undefined && focusSn !== r.sn;
        if (!c) {
          const x = r.element?.x ?? 0;
          const y = r.element?.y ?? 0;
          return (
            <g key={r.sn} opacity={dim ? 0.35 : 1}>
              <circle cx={x} cy={y} r={fs * 0.55} className="plan-radar missing" />
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
            <rect x={cont.x} y={cont.y} width={cont.width} height={cont.height} className="plan-container" />
            <rect x={b.x} y={b.y} width={b.width} height={b.height} className="plan-bound" />
            {hasBed && <rect x={sup.x} y={sup.y} width={sup.width} height={sup.height} className="plan-supervision" />}
            {zonesOf(c).map((z) => {
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
            <circle cx={rd.x} cy={rd.y} r={fs * 0.55} className="plan-radar" />
            <text x={rd.x} y={rd.y + (look && look[1] > 0 ? -fs * 0.9 : fs * 1.6)} textAnchor="middle" fontSize={fs} className="plan-label">
              {r.label}
            </text>
          </g>
        );
      })}
      {typeof children === "function" ? children(fs) : children}
    </svg>
  );
}

type Box = { x: number; y: number; w: number; h: number };
/** 最多放大到原来的 12 倍，最多缩小到 1.5 倍大小 */
const MAX_IN = 12;
const MAX_OUT = 1.5;

/** 平面图缩放 / 平移：viewBox 在 base 基础上变化；base 变了（换房间、布置变了）就复位 */
function useZoom(base: Box, enabled?: boolean) {
  const [zoom, setZoom] = useState<Box | null>(null);
  const [panning, setPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; v: Box; scale: number } | null>(null);
  const baseKey = `${base.x},${base.y},${base.w},${base.h}`;
  const baseRef = useRef(base);
  baseRef.current = base;

  useEffect(() => setZoom(null), [baseKey]);

  // 滚轮要 preventDefault（不然外层跟着滚），React 的 onWheel 是 passive 的，只能自己挂
  useEffect(() => {
    const el = svgRef.current;
    if (!enabled || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ctm = el.getScreenCTM();
      if (!ctm) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const b = baseRef.current;
      setZoom((cur) => {
        const v = cur ?? b;
        const w = Math.min(b.w * MAX_OUT, Math.max(b.w / MAX_IN, v.w * Math.exp(e.deltaY * 0.0015)));
        const k = w / v.w;
        return { x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w, h: v.h * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [enabled]);

  const v = (enabled && zoom) || base;
  return {
    v,
    svgRef,
    panning,
    onPointerDown: (e: PointerEvent<SVGSVGElement>) => {
      if (!enabled || e.button !== 0) return;
      const ctm = e.currentTarget.getScreenCTM();
      if (!ctm) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, v, scale: ctm.a };
      setPanning(true);
    },
    onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      if (!d) return;
      setZoom({ ...d.v, x: d.v.x - (e.clientX - d.x) / d.scale, y: d.v.y - (e.clientY - d.y) / d.scale });
    },
    onPointerUp: () => {
      drag.current = null;
      setPanning(false);
    },
    reset: () => enabled && setZoom(null),
  };
}

/** 平面图上的家具、文字、线条（只读展示） */
function PlanShape({ e }: { e: PlanElement }) {
  const x = e.x ?? 0;
  const y = e.y ?? 0;
  const w = e.width ?? 0;
  const h = e.height ?? 0;
  const tf = e.rotation ? `rotate(${e.rotation} ${x} ${y})` : undefined;
  if (e.type === 1)
    return (
      <g transform={`translate(${x} ${y})${e.rotation ? ` rotate(${e.rotation})` : ""}`}>
        {(e.children ?? []).filter((c) => c.type !== 3).map((c, i) => <PlanShape key={c.id ?? i} e={c} />)}
      </g>
    );
  if (e.type === 4 && e.src) return <image href={assetUrl(e.src)} x={x} y={y} width={w} height={h} transform={tf} preserveAspectRatio="none" opacity={0.7} />;
  if (e.type === 2) return <rect x={x} y={y} width={w} height={h} transform={tf} fill={e.fill && e.fill !== "#fff" ? e.fill : "none"} fillOpacity={0.3} stroke={e.stroke ?? "#B3B7C9"} strokeWidth={1} />;
  if (e.type === 5 && e.text)
    return (
      <text x={x} y={y + 14} transform={tf} fontSize={14} fill={e.fill ?? "#5B6078"}>
        {e.text}
      </text>
    );
  return null;
}
