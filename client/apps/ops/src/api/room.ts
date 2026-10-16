import { api, realtime } from "@radar/core";
import type { QlConfig } from "../rooms/qinglan";
import { isResponseOk, readDeviceProperties, type DeviceResponse } from "./device";

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

/** 保存房间布置（平台房间详情、换算都读这一份）。注意：不会下发到设备，只会把平台属性记录的值改掉 */
export async function saveRoomDesign(roomId: string, d: Pick<RoomDesign, "roomStyle" | "elements">) {
  await api.post<number>("/api/room/v3/design", { roomId, roomStyle: d.roomStyle, elements: d.elements });
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
export function readFromDevice(sn: string, names: string[], timeoutMs = 30_000) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const early: DeviceResponse[] = [];
    let seq: string | undefined;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      fn();
    };
    const take = (r: DeviceResponse) =>
      finish(() => (isResponseOk(r.code) ? resolve(r.data ?? {}) : reject(new Error(`${r.message || "设备返回错误"}（code ${r.code}）`))));
    const off = realtime.on("DeviceResponse", (payload) => {
      const r = payload as DeviceResponse;
      if (r?.sn !== sn || r.command !== "get-property") return;
      if (seq === undefined) early.push(r);
      else if (String(r.seq) === seq) take(r);
    });
    const timer = window.setTimeout(() => finish(() => reject(new Error("30 秒内设备没有应答，请确认设备在线"))), timeoutMs);
    readDeviceProperties(sn, names).then(
      (data) => {
        if (data && typeof data === "object") return finish(() => resolve(data as Record<string, unknown>));
        if (data === undefined || data === null || data === "") return finish(() => reject(new Error("读取指令没有返回序列号")));
        seq = String(data);
        const hit = early.find((r) => String(r.seq) === seq);
        if (hit) take(hit);
      },
      (e) => finish(() => reject(e)),
    );
  });
}
