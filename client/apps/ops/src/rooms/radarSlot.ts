import type { Radar } from "../api/device";
import { getRoomDesign, getRoomTypeDesignOf, roomSize, saveRoomDesign, type PlanElement, type RoomDesign } from "../api/room";
import { containerSize, radarInContainer, radarInRoom, supervisionSize, type QlConfig } from "./qinglan";

/**
 * 房间布置里的雷达位置。区域配置描述的是房间（门、床在哪），不是设备，所以：
 * - 设备离开房间时，布置里的雷达只清掉设备、留下空位置，下次装新设备直接沿用（clearSlot）
 * - 房间里没有雷达位置时（平台"移除设备"会连位置一起删），按"空位置 → 户型里的雷达 → 空白默认"找一个（slotSource）
 * 这样装设备不用回平台房间设计里重新放雷达。
 */

export type SlotSource =
  | { kind: "has" }
  | { kind: "placeholder"; el: PlanElement }
  | { kind: "roomType"; el: PlanElement; typeName?: string }
  | { kind: "blank" };

export const SLOT_TEXT: Record<SlotSource["kind"], string> = {
  has: "布置里已有这台雷达",
  placeholder: "放进布置里的空雷达位置（沿用那里的安装方式和区域）",
  roomType: "从户型拷一个雷达位置（沿用户型里的安装方式和区域）",
  blank: "在布置里新建雷达位置（侧装在上墙，没有区域，装好后到设备属性里画区域）",
};

export function findRadar(list: PlanElement[] | undefined, test: (e: PlanElement) => boolean): PlanElement | undefined {
  for (const e of list ?? []) {
    if (e.type === 3 && test(e)) return e;
    const c = findRadar(e.children, test);
    if (c) return c;
  }
}

/** 逐个处理雷达元素（含组合里的）；返回 null 删掉 */
export function mapRadars(list: PlanElement[] | undefined, fn: (e: PlanElement) => PlanElement | null): PlanElement[] {
  const out: PlanElement[] = [];
  for (const e of list ?? []) {
    if (e.type === 3) {
      const r = fn(e);
      if (r) out.push(r);
    } else out.push(e.children ? { ...e, children: mapRadars(e.children, fn) } : e);
  }
  return out;
}

const fits = (d: Radar) => (e: PlanElement) => e.deviceType === undefined || d.deviceType === undefined || e.deviceType === d.deviceType;
/** 空的雷达位置：没有设备、型号对得上、配过区域配置 */
const isPlaceholder = (d: Radar) => (e: PlanElement) => !e.sn && !e.deviceId && !!e.qingLanConfig && fits(d)(e);

/** 元素 id 要是 32 位十六进制，平台会丢掉其他格式的 id（2026-10-18 实测） */
const newId = () =>
  crypto.randomUUID?.().replace(/-/g, "") ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** 空白默认配置：侧装在上墙中间、往下看，床位监护，2.8 m，监测范围裁到墙内，没有区域 */
export function blankRadarConfig(room: { width: number; height: number }): QlConfig {
  const base: QlConfig = { workingType: 15, installType: 1, installDirection: 1, installHeight: 2.8 };
  const size = containerSize(base);
  const container = { x: Math.round(room.width / 2 - size.width / 2), y: 0, ...size };
  const r = radarInContainer(base);
  const x0 = Math.max(container.x, 0);
  const x1 = Math.min(container.x + size.width, room.width);
  const s = supervisionSize(base);
  return {
    ...base,
    container,
    radar: { x: r.x, y: r.y, width: 24, height: 24 },
    bound: { x: x0, y: 0, width: Math.max(x1 - x0, 0), height: Math.min(size.height, room.height) },
    supervision: { x: size.width / 2 - s / 2, y: 0 },
    ranges: [],
  };
}

/** 把设备放到雷达元素上（位置、配置不变） */
const withDevice = (e: PlanElement, d: Radar): PlanElement => ({ ...e, sn: d.sn, deviceId: d.id, deviceName: d.deviceName, deviceType: d.deviceType ?? e.deviceType });

/** 新房间里这台雷达该放在哪：已有 > 空位置 > 户型里的雷达 > 空白默认 */
export async function slotSource(d: Radar, roomId: string, design?: RoomDesign): Promise<SlotSource> {
  const cur = design ?? (await getRoomDesign(roomId));
  if (findRadar(cur?.elements, (e) => e.sn === d.sn)) return { kind: "has" };
  const ph = findRadar(cur?.elements, isPlaceholder(d));
  if (ph) return { kind: "placeholder", el: ph };
  // 户型里同型号、配过区域的雷达（id 和房间里冲突时 placeInLayout 会换一个）
  const type = await getRoomTypeDesignOf(roomId).catch(() => undefined);
  const t = findRadar(type?.elements, (e) => !!e.qingLanConfig && fits(d)(e));
  if (t) return { kind: "roomType", el: t, typeName: type?.roomTypeName };
  return { kind: "blank" };
}

/** 按 slotSource 的结果把设备放进房间布置并保存 */
export async function placeInLayout(d: Radar, roomId: string, src: SlotSource) {
  if (src.kind === "has") return;
  const design = await getRoomDesign(roomId);
  if (!design) throw new Error("房间布置读不到");
  let elements: PlanElement[];
  if (src.kind === "placeholder") {
    let done = false;
    elements = mapRadars(design.elements, (e) => {
      if (done || (src.el.id ? e.id !== src.el.id : !isPlaceholder(d)(e))) return e;
      done = true;
      return withDevice(e, d);
    });
    if (!done) throw new Error("布置里的空雷达位置已经不在了，请刷新后重试");
  } else if (src.kind === "roomType") {
    // 户型里的元素原样拷过来（深拷贝），id 和房间里已有的冲突就换一个
    const el: PlanElement = JSON.parse(JSON.stringify(src.el));
    const ids = new Set((design.elements ?? []).flatMap(function all(e): string[] {
      return [e.id ?? "", ...(e.children ?? []).flatMap(all)];
    }));
    if (!el.id || ids.has(el.id)) el.id = newId();
    elements = [...(design.elements ?? []), withDevice(el, d)];
  } else {
    const cfg = blankRadarConfig(roomSize(design));
    const at = radarInRoom(cfg);
    elements = [
      ...(design.elements ?? []),
      withDevice({ id: newId(), type: 3, width: 24, height: 24, x: Math.round(at.x), y: Math.round(at.y), src: "/images/plan/qinglan-radar.png", qingLanConfig: cfg }, d),
    ];
  }
  await saveRoomDesign(roomId, { roomStyle: design.roomStyle, elements });
}

/** 设备离开房间：keep = 留下空位置（清掉设备，保留安装方式和区域），否则连位置一起删 */
export async function clearSlot(sn: string, roomId: string, keep: boolean) {
  const design = await getRoomDesign(roomId);
  if (!design || !findRadar(design.elements, (e) => e.sn === sn)) return;
  const elements = mapRadars(design.elements, (e) => {
    if (e.sn !== sn) return e;
    if (!keep) return null;
    const { sn: _s, deviceId: _d, deviceName: _n, ...rest } = e;
    return rest;
  });
  await saveRoomDesign(roomId, { roomStyle: design.roomStyle, elements });
}
