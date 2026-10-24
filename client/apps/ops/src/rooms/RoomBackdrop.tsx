import { useId, type ReactNode } from "react";
import { assetUrl } from "@radar/core";
import type { PlanElement, RoomDesign } from "../api/room";
import { isDoor } from "./furniture/catalog";
import { FurnitureShape } from "./furniture/icons";

/**
 * 房间底图：网格、户型底图图片、家具和文字、房间外框（墙），按房间坐标画（1 = 1 cm）。
 * 诊断 / 监控的平面图、装修编辑器、设备安装设置的区域画布共用，各自在上面叠区域、雷达、实时目标等。
 * 区域画布按分米、以雷达为原点画，用 transform 套进去即可
 */
export default function RoomBackdrop({
  size,
  roomStyle,
  elements,
  grid = true,
  outline = true,
  className,
  transform,
  layer = "all",
  children,
}: {
  size: { width: number; height: number };
  /** 布置的外框；type 4 且带 src 时是户型底图 */
  roomStyle?: RoomDesign["roomStyle"];
  /** 布置里的元素（雷达会跳过）；装修编辑器自己画家具时只传别的元素 */
  elements?: PlanElement[];
  /** 画房间范围内的网格（区域画布有自己的网格时关掉） */
  grid?: boolean;
  /** 画房间外框（墙）；区域画布自己画墙时关掉 */
  outline?: boolean;
  className?: string;
  transform?: string;
  /**
   * 门放在墙和房间外框之后画，门洞才能把墙挖开（看着是打通的）。
   * all：全部；base：除门以外；doors：只画门（墙由调用方画在 base 和 doors 之间时用）
   */
  layer?: "all" | "base" | "doors";
  /** 画在家具之上、墙之下（装修编辑器的可拖动家具） */
  children?: ReactNode;
}) {
  // 网格 pattern 每张图单独起 id：监控模式盖在房间布置页上面时两张图同时在页面里，同名 id 会用到另一张图的网格（颜色、线宽都不对）
  const gridId = `plan-grid-${useId().replace(/[^\w-]/g, "")}`;
  const { width, height } = size;
  const list = (elements ?? []).filter((e) => e.type !== 3);
  const doors = list.filter(isDoor).map((e, i) => <PlanShape key={e.id ?? `d${i}`} e={e} />);
  if (layer === "doors")
    return (
      <g className={className} transform={transform}>
        {doors}
      </g>
    );
  return (
    <g className={className} transform={transform}>
      {grid && (
        <>
          <defs>
            <pattern id={gridId} width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#EEF0F5" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x={0} y={0} width={width} height={height} fill={`url(#${gridId})`} />
        </>
      )}
      {roomStyle?.type === 4 && roomStyle.src && <image href={assetUrl(roomStyle.src)} x={0} y={0} width={width} height={height} preserveAspectRatio="none" opacity={0.55} />}
      {list
        .filter((e) => !isDoor(e))
        .map((e, i) => (
          <PlanShape key={e.id ?? i} e={e} />
        ))}
      {children}
      {outline && <rect x={0} y={0} width={width} height={height} className="plan-room" />}
      {layer === "all" && doors}
    </g>
  );
}

/** 平面图上的家具、文字（只读展示） */
function PlanShape({ e }: { e: PlanElement }) {
  const x = e.x ?? 0;
  const y = e.y ?? 0;
  const tf = e.rotation ? `rotate(${e.rotation} ${x} ${y})` : undefined;
  if (e.type === 1)
    return (
      <g transform={`translate(${x} ${y})${e.rotation ? ` rotate(${e.rotation})` : ""}`}>
        {(e.children ?? []).filter((c) => c.type !== 3).map((c, i) => <PlanShape key={c.id ?? i} e={c} />)}
      </g>
    );
  if (e.type === 4 || e.type === 2) return <FurnitureShape e={e} />;
  if (e.type === 5 && e.text)
    return (
      <text x={x} y={y + 14} transform={tf} fontSize={14} fill={e.fill ?? "#5B6078"}>
        {e.text}
      </text>
    );
  return null;
}
