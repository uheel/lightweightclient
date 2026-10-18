import { api } from "@radar/core";
import { renumberZones, type QlConfig } from "../rooms/qinglan";
import { awaitDeviceResponse, readDeviceProperties } from "./device";

/** 房间与房间布置（v3 接口，见 docs/site-analysis.md"房间户型与雷达区域下发"） */

export interface Room {
  id: string;
  roomName: string;
  buildingId?: string;
  buildingName?: string;
  buildingSortOrder?: number;
  floorId?: string;
  floorName?: string;
  floorNumber?: number;
  /** 平台要求必填，客户端不用它（户型只在建房时拷贝一次，之后和房间无关） */
  roomTypeId?: string;
  roomTypeName?: string;
  /** 米：宽 = 平面图水平方向，长 = 垂直方向 */
  roomWidth?: number;
  roomLong?: number;
  bedCount?: number;
  sortOrder?: number;
}

/** 当前机构的全部房间（数量不大，一次取完，在客户端筛选） */
export async function getRooms() {
  return (await api.get<Room[]>("/api/room/pages", { params: { current: 1, pageSize: 5000 } })).data ?? [];
}

/** 平面图元素：1 组合，2 矩形，3 设备（雷达），4 图片，5 文本，6 线段 */
export interface PlanElement {
  id?: string;
  type: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  src?: string;
  text?: string;
  fill?: string;
  stroke?: string;
  sn?: string;
  deviceId?: string;
  deviceName?: string;
  deviceType?: number;
  qingLanConfig?: QlConfig;
  isBedSlot?: boolean;
  children?: PlanElement[];
}

export interface RoomDesign {
  id: string;
  roomName?: string;
  roomTypeId?: string;
  roomTypeName?: string;
  /** 房间外框：width / height 单位 cm；type 4 且带 src 时是户型底图 */
  roomStyle?: { width?: number; height?: number; type?: number; src?: string; fill?: string };
  elements?: PlanElement[];
  roomWidth?: number;
  roomLong?: number;
}

/** 房间布置（平台"房间设计"保存的那份，房间详情页读的也是它） */
export async function getRoomDesign(roomId: string) {
  return (await api.get<RoomDesign>("/api/room/v3/design", { params: { roomId } })).data;
}

/**
 * 保存房间布置（平台房间详情、换算都读这一份）。注意：不会下发到设备，只会把平台属性记录的值改掉。
 * 保存时把每台雷达的区域 index 重写成位置，让平台画布显示的编号和设备上的一致（平台下发按位置编号）。
 */
export async function saveRoomDesign(roomId: string, d: Pick<RoomDesign, "roomStyle" | "elements">) {
  const fix = (list?: PlanElement[]): PlanElement[] | undefined =>
    list?.map((e) => ({
      ...e,
      ...(e.type === 3 && e.qingLanConfig ? { qingLanConfig: renumberZones(e.qingLanConfig) } : {}),
      ...(e.children ? { children: fix(e.children) } : {}),
    }));
  await api.post<number>("/api/room/v3/design", { roomId, roomStyle: d.roomStyle, elements: fix(d.elements) });
}

/** 房间所用户型的当前设计（户型改过的话是改后的，和房间里的拷贝无关） */
export async function getRoomTypeDesignOf(roomId: string) {
  return (await api.get<RoomDesign>("/api/room/v3/current-room-type-design", { params: { roomId } })).data;
}

/** 房间布置里的雷达元素（含组合里的） */
export function radarElements(d?: RoomDesign) {
  const out: PlanElement[] = [];
  const walk = (list?: PlanElement[]) => {
    for (const e of list ?? []) {
      if (e.type === 3) out.push(e);
      walk(e.children);
    }
  };
  walk(d?.elements);
  return out;
}

/** 房间外框尺寸（cm）：以布置里的外框为准，没有时用房间长宽 */
export function roomSize(d?: RoomDesign, r?: Room) {
  const w = d?.roomStyle?.width || Math.round((d?.roomWidth ?? r?.roomWidth ?? 4) * 100);
  const h = d?.roomStyle?.height || Math.round((d?.roomLong ?? r?.roomLong ?? 4) * 100);
  return { width: w, height: h };
}

/**
 * 从设备读一次属性：下发 readproperty 后等实时推送里的应答（按 sn + seq 对上），30 秒超时。
 * 6 型应答里的键是报文别名（QL_radar_para_config），13 型是字典名（QL_radar_config），调用方两种都要认。
 * 注意：读回的值平台也会存成"平台记录"。
 */
export async function readFromDevice(sn: string, names: string[], timeoutMs = 30_000) {
  return (await awaitDeviceResponse<Record<string, unknown>>(sn, "get-property", () => readDeviceProperties(sn, names), timeoutMs)) ?? {};
}
