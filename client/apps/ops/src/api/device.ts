import { api } from "@radar/core";

/** 运维端专用：设备相关接口（用户端不使用，不放进 core） */

/** 雷达设备（/api/device/v3/radar-pages），比全类型设备列表多房间、信号、最近活动等字段 */
export interface Radar {
  id: string;
  sn: string;
  deviceName: string;
  deviceType?: number;
  orgId: string;
  orgName: string;
  roomId?: string;
  roomName?: string;
  communicationType?: number;
  isOnline: boolean;
  isDisabled: boolean;
  firmwareVersion?: string;
  rssi?: number;
  lastActivityTime?: string;
  memberCount?: number;
  realName?: string;
  memberId?: string;
}

/** 当前机构的全部雷达（数量不大，一次取完，在客户端筛选） */
export async function getRadars() {
  const res = await api.get<Radar[]>("/api/device/v3/radar-pages", { params: { current: 1, pageSize: 5000 } });
  return res.data ?? [];
}

export interface DeviceType {
  deviceType?: number;
  deviceTypeCode?: number;
  deviceTypeName?: string;
  name?: string;
  groupCode?: string;
}

/** 设备类型字典：编号 → 名称 */
export async function getDeviceTypeMap() {
  const list = (await api.get<DeviceType[]>("/api/device-type/types")).data ?? [];
  const map = new Map<number, string>();
  for (const t of list) {
    const code = t.deviceTypeCode ?? t.deviceType;
    const name = t.deviceTypeName ?? t.name;
    if (code !== undefined && name) map.set(code, name);
  }
  return map;
}

// ---------- 房间布局里的雷达安装配置 ----------

export interface QingLanConfig {
  /** 0 顶装，1 侧装 */
  installType?: number;
  /** 1 上，2 右，3 下，4 左 */
  installDirection?: number;
  /** 安装高度，单位米（房间布局里其他坐标是厘米，这个不是） */
  installHeight?: number;
  /** 3 人员跟踪，7 跌倒监测，11 呼吸睡眠，15 床位监护 */
  workingType?: number;
  ranges?: { type: number; index?: number; text?: string }[];
}

interface RoomElement {
  type: number;
  sn?: string;
  qingLanConfig?: QingLanConfig;
  children?: RoomElement[];
}

interface RoomDetail {
  roomId: string;
  roomName: string;
  buildingName?: string;
  floorName?: string;
  elements?: RoomElement[];
}

export interface RoomInfo {
  roomName: string;
  place: string;
  /** sn → 安装配置 */
  configs: Map<string, QingLanConfig>;
}

/** 房间详情：位置与每台雷达的安装配置（安装方式、方向、高度、工作模式） */
export async function getRoomInfo(roomId: string): Promise<RoomInfo> {
  const d = (await api.get<RoomDetail>("/api/room-view/v3/detail", { params: { roomId } })).data;
  const configs = new Map<string, QingLanConfig>();
  const walk = (list?: RoomElement[]) => {
    for (const e of list ?? []) {
      if (e.type === 3 && e.sn && e.qingLanConfig) configs.set(e.sn, e.qingLanConfig);
      walk(e.children);
    }
  };
  walk(d?.elements);
  return {
    roomName: d?.roomName ?? "",
    place: [d?.buildingName, d?.floorName, d?.roomName].filter(Boolean).join(" / "),
    configs,
  };
}

export const INSTALL_TYPE: Record<number, string> = { 0: "顶装", 1: "侧装" };
export const INSTALL_DIR: Record<number, string> = { 1: "朝上", 2: "朝右", 3: "朝下", 4: "朝左" };
export const WORKING_TYPE: Record<number, string> = { 3: "人员跟踪", 7: "跌倒监测", 11: "呼吸睡眠", 15: "床位监护" };

// ---------- 通信日志 ----------

export interface DeviceLog {
  id?: string;
  createdAt: string;
  sn: string;
  deviceType?: number;
  command?: string;
  /** 1 设备上报，2 平台下发（以实际返回为准） */
  direction?: number;
  topic?: string;
  rawData?: string;
}

export interface LogQuery {
  sn: string;
  command?: string;
  /** "YYYY-MM-DD HH:mm:ss" */
  range?: [string, string];
  current: number;
  pageSize: number;
}

/**
 * 一台设备的通信日志（MQTT），按时间倒序。
 * 必须带 sn：不带 sn 时平台要求 all=true 扫当天全部设备的日志，设备多的机构会一直不返回（2026-10-15 实测卡住）。
 */
export async function getDeviceLogs(q: LogQuery) {
  const res = await api.get<DeviceLog[]>("/api/device-log/pages", {
    params: { current: q.current, pageSize: q.pageSize },
    filter: {
      sn: q.sn,
      command: q.command,
      createdAt: q.range ? q.range.join(",") : undefined,
    },
  });
  return { list: res.data ?? [], total: res.total ?? 0 };
}

// ---------- 心跳 / 安装角度 ----------

export interface Heartbeat {
  /** 毫秒 */
  t: number;
  x: number;
  y: number;
  z: number;
  rssi?: number;
  fw?: string;
  ip?: string;
}

const parseTime = (s: string) => Date.parse(s.replace(" ", "T"));

/**
 * 心跳（约每分钟一次）。每次心跳日志里有两条记录，只有设备上报的那条带 install = [angle_x, angle_y, angle_z]。
 * 不传 range 时取最近的 limit 条日志。返回按时间正序。
 */
export async function getHeartbeats(sn: string, range?: [string, string], limit = 3000) {
  const res = await api.get<DeviceLog[]>("/api/device-log/pages", {
    params: { current: 1, pageSize: limit },
    filter: { sn, command: "Device.heartbeat", createdAt: range?.join(",") },
  });
  const out: Heartbeat[] = [];
  for (const row of res.data ?? []) {
    let raw: { params?: { install?: unknown[]; rssi?: number; firmware_ver?: string; IP?: string } } | undefined;
    try {
      raw = row.rawData ? JSON.parse(row.rawData) : undefined;
    } catch {
      continue;
    }
    const p = raw?.params;
    if (p && Array.isArray(p.install) && p.install.length >= 3) {
      out.push({ t: parseTime(row.createdAt), x: +p.install[0]!, y: +p.install[1]!, z: +p.install[2]!, rssi: p.rssi, fw: p.firmware_ver, ip: p.IP });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------- 告警 ----------

export interface OpsAlert {
  id: string;
  alertTypeName: string;
  alertTypeGroup?: number;
  /** 1 未处理，2 已处理 */
  alertStatus: number;
  sn?: string;
  deviceName?: string;
  buildingName?: string;
  floorName?: string;
  roomName?: string;
  createdAt: string;
  alertProcessTypeName?: string;
  processingResults?: string;
  processByUserName?: string;
  processAt?: string;
}

/** 告警分组：运维端默认关注 3 离线、5 安装姿态，其他分组也能查 */
export const ALERT_GROUPS = [
  { value: 3, label: "设备离线" },
  { value: 5, label: "安装姿态" },
  { value: 2, label: "事件" },
  { value: 1, label: "场景" },
  { value: 4, label: "紧急求助" },
];

export async function getAlertPage(q: { group: number; status?: 1 | 2; sn?: string; range?: [string, string]; current: number; pageSize: number }) {
  const res = await api.get<OpsAlert[]>("/api/alert/pages", {
    params: { current: q.current, pageSize: q.pageSize },
    filter: { alertTypeGroup: q.group, alertStatus: q.status, sn: q.sn, createdAt: q.range ? q.range.join(",") : undefined },
  });
  return { list: res.data ?? [], total: res.total ?? 0 };
}
