import type { Radar } from "../api/device";
import { getRoomDesign, getRoomTypeDesignOf, roomSize, saveRoomDesign, type PlanElement, type RoomDesign } from "../api/room";
import { installAreaOf, withArea, type InstallArea } from "./installArea";
import { containerSize, radarInContainer, radarInRoom, supervisionSize, type QlConfig } from "./qinglan";

/**
 * 房间布置里的雷达位置。区域配置描述的是房间（门、床在哪），不是设备，所以：
 * - 设备离开房间时，布置里的雷达只清掉设备、留下空位置，下次装新设备直接沿用（clearSlot）
 * - 房间里没有雷达位置时（平台"移除设备"会连位置一起删），按"空位置 → 户型里的雷达 → 空白默认"找一个（slotSource）
 * 这样装设备不用回平台房间设计里重新放雷达。
 * 一个房间可以装几台雷达（卧室一台、卫生间一台，型号也可以不同），每台各占一个位置，靠安装区域分清（rooms/installArea.ts）。
 */

export type SlotSource = {
  /** 这个位置原来的安装区域（空位置、户型里的雷达上带的） */
  area?: InstallArea;
  /** 房间布置里已经装着别的设备的雷达位置数 */
  peers: number;
} & (
  | { kind: "has" }
  | { kind: "placeholder"; el: PlanElement }
  | { kind: "roomType"; el: PlanElement; typeName?: string }
  | { kind: "blank" }
);

export const SLOT_TEXT: Record<SlotSource["kind"], string> = {
  has: "布置里已有这台雷达",
  placeholder: "放进布置里的空雷达位置（沿用那里的安装方式和区域）",
  roomType: "从户型拷一个雷达位置（沿用户型里的安装方式和区域）",
  blank: "在布置里新建雷达位置（没有区域，装好后到设备属性里画区域）",
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
export const newId = () =>
  crypto.randomUUID?.().replace(/-/g, "") ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** 空白默认配置：侧装在上墙中间、往下看，顶装在房间正中；床位监护，2.8 m，监测范围裁到墙内，没有区域 */
export function blankRadarConfig(room: { width: number; height: number }, installType: 0 | 1 = 1): QlConfig {
  const base: QlConfig = { workingType: 15, installType, installDirection: 1, installHeight: 2.8 };
  const top = installType === 0;
  const size = containerSize(base);
  const container = { x: Math.round(room.width / 2 - size.width / 2), y: top ? Math.round(room.height / 2 - size.height / 2) : 0, ...size };
  const r = radarInContainer(base);
  const x0 = Math.max(container.x, 0);
  const x1 = Math.min(container.x + size.width, room.width);
  const y0 = Math.max(container.y, 0);
  const y1 = Math.min(container.y + size.height, room.height);
  const s = supervisionSize(base);
  return {
    ...base,
    container,
    radar: { x: r.x, y: r.y, width: 24, height: 24 },
    bound: { x: x0, y: y0, width: Math.max(x1 - x0, 0), height: Math.max(y1 - y0, 0) },
    // 监护区贴着雷达：侧装在容器上边中间，顶装在容器正中
    supervision: { x: size.width / 2 - s / 2, y: top ? size.height / 2 - s / 2 : 0 },
    ranges: [],
  };
}

/** 把设备放到雷达元素上（位置、配置不变） */
const withDevice = (e: PlanElement, d: Radar): PlanElement => ({ ...e, sn: d.sn, deviceId: d.id, deviceName: d.deviceName, deviceType: d.deviceType ?? e.deviceType });

/** 布置里全部雷达元素（含组合里的） */
function allRadars(list?: PlanElement[]): PlanElement[] {
  return (list ?? []).flatMap((e) => [...(e.type === 3 ? [e] : []), ...allRadars(e.children)]);
}

/** 两个雷达元素差不多在同一个地方（户型里的雷达已经拷进房间、改过 id 的也认得出来） */
const near = (a: PlanElement, b: PlanElement) => Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0)) < 50;

/** 新房间里这台雷达该放在哪：已有 > 空位置 > 户型里的雷达（房间里还没用上的） > 空白默认 */
export async function slotSource(d: Radar, roomId: string, design?: RoomDesign): Promise<SlotSource> {
  const cur = design ?? (await getRoomDesign(roomId));
  const radars = allRadars(cur?.elements);
  const peers = radars.filter((e) => (e.sn || e.deviceId) && e.sn !== d.sn).length;
  const has = d.sn ? radars.find((e) => e.sn === d.sn) : undefined;
  if (has) return { kind: "has", area: installAreaOf(has), peers };
  const ph = findRadar(cur?.elements, isPlaceholder(d));
  if (ph) return { kind: "placeholder", el: ph, area: installAreaOf(ph), peers };
  // 户型里同型号、配过区域的雷达，跳过房间里已经有的（户型有卧室、卫生间两台时，第二台设备拿到的是卫生间那台；id 和房间里冲突时 placeInLayout 会换一个）
  const type = await getRoomTypeDesignOf(roomId).catch(() => undefined);
  const ids = new Set(radars.map((e) => e.id).filter(Boolean));
  const t = allRadars(type?.elements).find((e) => !!e.qingLanConfig && fits(d)(e) && !(e.id && ids.has(e.id)) && !radars.some((r) => near(r, e)));
  if (t) return { kind: "roomType", el: t, typeName: type?.roomTypeName, area: installAreaOf(t), peers };
  return { kind: "blank", peers };
}

/**
 * 按 slotSource 的结果把设备放进房间布置并保存。
 * area：这台雷达的安装区域；不传时沿用位置上原有的（户型里存在 qingLanConfig.extra 的，拷过来时写成房间布置用的 rangeType）
 * installType：新建空白位置时的装法（0 顶装，1 侧装），其他来源沿用原来的
 */
export async function placeInLayout(d: Radar, roomId: string, src: SlotSource, area?: InstallArea | null, installType: 0 | 1 = 1) {
  if (src.kind === "has") return;
  const design = await getRoomDesign(roomId);
  if (!design) throw new Error("房间布置读不到");
  let elements: PlanElement[];
  if (src.kind === "placeholder") {
    let done = false;
    elements = mapRadars(design.elements, (e) => {
      if (done || (src.el.id ? e.id !== src.el.id : !isPlaceholder(d)(e))) return e;
      done = true;
      return area !== undefined ? withArea(withDevice(e, d), area) : withDevice(e, d);
    });
    if (!done) throw new Error("布置里的空雷达位置已经不在了，请刷新后重试");
  } else if (src.kind === "roomType") {
    // 户型里的元素原样拷过来（深拷贝），id 和房间里已有的冲突就换一个
    const el: PlanElement = JSON.parse(JSON.stringify(src.el));
    const ids = new Set((design.elements ?? []).flatMap(function all(e): string[] {
      return [e.id ?? "", ...(e.children ?? []).flatMap(all)];
    }));
    if (!el.id || ids.has(el.id)) el.id = newId();
    const a = area !== undefined ? area : installAreaOf(el) ?? null;
    elements = [...(design.elements ?? []), withArea(withDevice(el, d), a)];
  } else {
    const cfg = blankRadarConfig(roomSize(design), installType);
    const at = radarInRoom(cfg);
    const el = withDevice({ id: newId(), type: 3, width: 24, height: 24, x: Math.round(at.x), y: Math.round(at.y), src: "/images/plan/qinglan-radar.png", qingLanConfig: cfg }, d);
    elements = [...(design.elements ?? []), area ? withArea(el, area) : el];
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

/**
 * 设备改名后，把房间布置里这台雷达位置上存的设备名也改掉（布置在建房 / 装设备时拷了一份 deviceName，平台网页的房间图显示的是这份）。
 * 名字本来就一样时不保存
 */
export async function syncSlotName(roomId: string, sn: string, deviceName: string) {
  const design = await getRoomDesign(roomId);
  if (!design || !findRadar(design.elements, (e) => e.sn === sn && e.deviceName !== deviceName)) return false;
  await saveRoomDesign(roomId, { roomStyle: design.roomStyle, elements: mapRadars(design.elements, (e) => (e.sn === sn ? { ...e, deviceName } : e)) });
  return true;
}

/** 改布置里这台雷达的安装区域（只保存布置；设备上没有这一项，不用下发）。返回 false = 布置里没有这台 */
export async function setSlotArea(roomId: string, sn: string, area: InstallArea | null) {
  const design = await getRoomDesign(roomId);
  if (!design || !findRadar(design.elements, (e) => e.sn === sn)) return false;
  await saveRoomDesign(roomId, { roomStyle: design.roomStyle, elements: mapRadars(design.elements, (e) => (e.sn === sn ? withArea(e, area) : e)) });
  return true;
}
