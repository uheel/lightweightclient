import dayjs from "dayjs";
import { api, realtime } from "@radar/core";
import type { PlanElement, RoomDesign } from "./room";
import { installAreaOf, type InstallArea } from "../rooms/installArea";
import { getRoomView } from "./roomView";

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
  for (const d of res.data ?? []) deviceIdCache.set(d.sn, Promise.resolve(d.id));
  return res.data ?? [];
}

/** SN → deviceId（raw-values 只认 deviceId）。getRadars 取过的直接用，没有时按 SN 查一次 */
const deviceIdCache = new Map<string, Promise<string | undefined>>();

function deviceIdOf(sn: string) {
  let p = deviceIdCache.get(sn);
  if (!p) {
    p = api
      .get<Radar[]>("/api/device/v3/radar-pages", { params: { current: 1, pageSize: 20 }, filter: { sn } })
      .then((r) => (r.data ?? []).find((d) => d.sn === sn)?.id);
    p.then((id) => !id && deviceIdCache.delete(sn), () => deviceIdCache.delete(sn));
    deviceIdCache.set(sn, p);
  }
  return p;
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

/** 设备类型字典：编号 → 分组（RADAR / SLAVE / WATCH / RING / GAIT / OTHER） */
export async function getDeviceTypeGroups() {
  const list = (await api.get<DeviceType[]>("/api/device-type/types")).data ?? [];
  const map = new Map<number, string>();
  for (const t of list) {
    const code = t.deviceTypeCode ?? t.deviceType;
    if (code !== undefined && t.groupCode) map.set(code, t.groupCode);
  }
  return map;
}

// ---------- 添加设备 ----------

/** 雷达类的设备类型（groupCode = RADAR），用于添加设备时选择 */
export async function getRadarTypes() {
  const list = (await api.get<DeviceType[]>("/api/device-type/types")).data ?? [];
  return list
    .filter((t) => t.groupCode === "RADAR" && t.deviceType !== undefined)
    .map((t) => ({ value: t.deviceType!, label: t.deviceTypeName ?? t.name ?? String(t.deviceType) }));
}

export interface NewRadar {
  deviceName: string;
  sn: string;
  deviceType: number;
  description?: string;
  /** 安装位置，可以不填（之后在平台的房间平面图里再装） */
  buildingId?: string;
  floorId?: string;
  roomId?: string;
}

/** 新增设备，和平台雷达设备页的"新增"一样（POST /api/device/v3）。SN 全平台唯一，重复时平台报错 */
export async function createRadar(d: NewRadar) {
  const res = await api.post<string>("/api/device/v3", {
    deviceName: d.deviceName,
    sn: d.sn,
    deviceType: d.deviceType,
    description: d.description,
    properties: { buildingId: d.buildingId, floorId: d.floorId, roomId: d.roomId },
  });
  return res.data;
}

/**
 * 新增蓝牙外设，和平台"智能设备管理 › 蓝牙外设"的"新增"一样（同样是 POST /api/device/v3）。
 * sn 就是外设 ID（≤32，全平台唯一），名称 ≤64。和雷达的绑定不在这里，是写雷达的 slave_config 属性
 */
export async function createSlave(d: { deviceName: string; sn: string; deviceType: number; description?: string }) {
  const res = await api.post<string>("/api/device/v3", d);
  return res.data;
}

/** 设备记录（GET /api/device/v3?id=），编辑时要整条带回 */
interface DeviceRecord {
  id: string;
  deviceName: string;
  sn: string;
  deviceType: number;
  sortOrder?: number;
  description?: string;
  properties?: { roomId?: string | null; buildingId?: string | null; floorId?: string | null; bedId?: string | null };
}

/**
 * 改设备的安装位置（房间绑定），和平台雷达设备页"编辑"一样：PUT /api/device/v3，整条记录带回，properties 里放位置；roomId 为 null = 解绑。
 * 只改绑定（device.roomId），不动房间布置和床位绑定（2026-10-18 在 …0901d0 上实测），那两份要调用方自己处理，见 docs/room-device-model.md。
 */
export async function setRadarLocation(deviceId: string, loc: { buildingId?: string; floorId?: string; roomId?: string } | null) {
  const rec = (await api.get<DeviceRecord>("/api/device/v3", { params: { id: deviceId, propertyNames: "roomId" } })).data;
  if (!rec) throw new Error("设备记录读不到");
  await api.put("/api/device/v3", {
    id: rec.id,
    deviceName: rec.deviceName,
    sn: rec.sn,
    deviceType: rec.deviceType,
    sortOrder: rec.sortOrder,
    description: rec.description,
    properties: loc?.roomId ? { roomId: loc.roomId, buildingId: loc.buildingId, floorId: loc.floorId } : { roomId: null },
  });
}

/**
 * 改设备名：同样是 PUT /api/device/v3 整条带回。properties 不带的话平台会把房间绑定清掉（GET 不带 propertyNames 时 properties 是空的），
 * 所以先取出位置原样带回，改完再读一次核对房间绑定没变。
 * propertyNames 只能写 roomId（会连楼栋、楼层、床位一起返回）；写成 "roomId,buildingId,floorId" 反而什么都不返回（2026-10-20 实测），
 * 所以再拿设备列表里的 roomId 核对一遍，对不上就不改
 */
export async function renameRadar(deviceId: string, deviceName: string, roomId?: string) {
  const read = async () => (await api.get<DeviceRecord>("/api/device/v3", { params: { id: deviceId, propertyNames: "roomId" } })).data;
  const rec = await read();
  if (!rec) throw new Error("设备记录读不到");
  const p = rec.properties ?? {};
  if ((p.roomId ?? null) !== (roomId ?? null)) throw new Error("读到的房间绑定和设备列表对不上，没有改名，刷新后再试");
  await api.put("/api/device/v3", {
    id: rec.id,
    deviceName,
    sn: rec.sn,
    deviceType: rec.deviceType,
    sortOrder: rec.sortOrder,
    description: rec.description,
    properties: p.roomId ? { roomId: p.roomId, buildingId: p.buildingId, floorId: p.floorId } : { roomId: null },
  });
  const after = await read();
  if ((after?.properties?.roomId ?? null) !== (p.roomId ?? null)) throw new Error("改名后房间绑定变了，请到安装位置里检查");
}

/**
 * 删除设备，和平台雷达设备页右键"删除"一样：DELETE /api/device/v3?id=。
 * 平台会一起清掉房间绑定、床位绑定和长者关联，但房间布置里的雷达位置不会跟着清（2026-10-20 实测），调用方自己处理，见 devices/deleteRadar.ts。
 * 删除后同一个 SN 可以重新添加，但会是新的 deviceId，平台上的属性记录、场景记录不会带过去
 */
export async function deleteRadar(deviceId: string) {
  const res = await api.del<number | boolean>("/api/device/v3", { params: { id: deviceId } });
  if (res.data === 0 || res.data === false) throw new Error("平台没有删除，可能已经被删掉了，刷新一下再看");
}

/** 绑在房间上的设备（平台房间设计左侧的设备列表），带床位绑定 */
export interface RoomDevice {
  deviceId: string;
  sn: string;
  deviceName?: string;
  bedId?: string;
  bedName?: string;
}

export async function getRoomDevices(roomId: string) {
  return (await api.get<RoomDevice[]>("/api/room/radars", { params: { roomId } })).data ?? [];
}

/** 解除床位上的设备绑定。注意：平台会连设备的房间绑定一起清掉，要留在房间里用 unbindBedKeepRoom */
export async function unbindBedDevice(bedId: string) {
  await api.put("/api/device-position/unbind-bed-device", { bedId });
}

/** 床位绑设备：一台设备只能绑一张床；平台会把设备的房间改成床位所在的房间（布置不动），所以只给同房间的设备绑 */
export async function bindBedDevice(bedId: string, deviceId: string) {
  await api.put("/api/device-position/bind-bed-device", { bedId, deviceId });
}

/** 设备绑房间（只改绑定，不动房间布置） */
export async function bindRoomDevice(roomId: string, deviceId: string) {
  await api.put("/api/device-position/bind-room-device", { roomId, deviceId });
}

/** 从床位上解绑设备，但设备留在房间里（平台解绑床位会清掉房间绑定，再绑回去） */
export async function unbindBedKeepRoom(bedId: string, roomId: string, deviceId: string) {
  await unbindBedDevice(bedId);
  await bindRoomDevice(roomId, deviceId);
}

export interface Option {
  label: string;
  value: string;
}

export async function getBuildingOptions() {
  return (await api.get<Option[]>("/api/building/options")).data ?? [];
}
export async function getFloorOptions(buildingId: string) {
  return (await api.get<Option[]>("/api/floor/options", { params: { buildingId } })).data ?? [];
}
export async function getRoomOptions(floorId: string) {
  return (await api.get<Option[]>("/api/room/options", { params: { floorId } })).data ?? [];
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
  deviceName?: string;
  /** 安装区域编号和别名，见 rooms/installArea.ts */
  rangeType?: number | null;
  rangeName?: string | null;
  qingLanConfig?: QingLanConfig;
  children?: RoomElement[];
}

interface RoomDetail {
  roomId: string;
  roomName: string;
  /** 房间外框，cm；type 4 且带 src 时是户型底图 */
  background?: { width?: number; height?: number; type?: number; src?: string };
  buildingName?: string;
  floorName?: string;
  elements?: RoomElement[];
}

export interface RoomInfo {
  roomName: string;
  place: string;
  /** 房间外框尺寸，cm */
  size?: { width: number; height: number };
  /** 外框样式（户型底图）和布置里的元素：区域画布在下面画出家具（见 rooms/RoomBackdrop.tsx） */
  roomStyle?: RoomDesign["roomStyle"];
  elements?: PlanElement[];
  /** sn → 安装配置 */
  configs: Map<string, QingLanConfig>;
  /** 布置里装着设备的雷达（一个房间可以有几台：卧室一台、卫生间一台） */
  radars: { sn: string; deviceName?: string; area?: InstallArea }[];
}

/** 房间详情：位置与每台雷达的安装配置（安装方式、方向、高度、工作模式） */
export async function getRoomInfo(roomId: string): Promise<RoomInfo> {
  const d = await getRoomView<RoomDetail>(roomId);
  const configs = new Map<string, QingLanConfig>();
  const radars: RoomInfo["radars"] = [];
  const walk = (list?: RoomElement[]) => {
    for (const e of list ?? []) {
      if (e.type === 3 && e.sn && e.qingLanConfig) configs.set(e.sn, e.qingLanConfig);
      if (e.type === 3 && e.sn) radars.push({ sn: e.sn, deviceName: e.deviceName, area: installAreaOf(e as PlanElement) });
      walk(e.children);
    }
  };
  walk(d?.elements);
  return {
    roomName: d?.roomName ?? "",
    place: [d?.buildingName, d?.floorName, d?.roomName].filter(Boolean).join(" / "),
    size: d?.background?.width && d.background.height ? { width: d.background.width, height: d.background.height } : undefined,
    roomStyle: d?.background,
    elements: d?.elements as PlanElement[] | undefined,
    configs,
    radars,
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

/**
 * 一台设备在时间范围内的全部通信日志（MQTT，按时间倒序，最多 max 条）：各页并发取回后合并，见 api.getAll。
 * 必须带 sn：不带 sn 时平台要求 all=true 扫当天全部设备的日志，设备多的机构会一直不返回（2026-10-15 实测卡住）。
 */
export async function getAllDeviceLogs(q: { sn: string; command?: string; range: [string, string]; pageSize: number; max: number }) {
  const res = await api.getAll<DeviceLog>("/api/device-log/pages", {
    pageSize: q.pageSize,
    max: q.max,
    filter: { sn: q.sn, command: q.command, createdAt: q.range.join(",") },
  });
  return { list: res.data ?? [], total: res.total ?? 0, perf: res.perf };
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
const LOG_FMT = "YYYY-MM-DD HH:mm:ss";

/**
 * Ultra 系列（13 UltraFall，15 UltraPlus）走 sdb/slim 这套报文，上报都是 post，params 是 [[类型, 设备时间(秒), …], …]：
 * 0 注册信息、1 信号 [1, ts, rssi]、3 心跳 [3, ts]（每分钟）、10 安装角度 [10, ts, x, y, z]。
 * 角度含义和 AIO 的 install 一样，但**只在姿态变化时上报**，装好不动就一直不报（2026-10-21 …D339 实测）。
 * 属性 QL_radar_install 写 1 后持续上报约 70 秒（约每秒一个采样，两个一条），然后设备自己改回 0。
 * 15 型还没有设备核对过，按同一套处理。
 */
export const isSlim = (deviceType?: number) => deviceType === 13 || deviceType === 15;

type SlimItem = [number, number, ...unknown[]];
function slimItems(row: DeviceLog): SlimItem[] {
  try {
    const p = row.rawData ? JSON.parse(row.rawData)?.params : undefined;
    return Array.isArray(p) ? p.filter((it): it is SlimItem => Array.isArray(it) && typeof it[0] === "number") : [];
  } catch {
    return [];
  }
}

/**
 * 安装角度。AIO 来自心跳（约每分钟一次）：每次心跳日志里有两条记录，只有设备上报的那条带 install = [angle_x, angle_y, angle_z]。
 * Ultra 系列来自 post 里的 [10, …]，用 filter[rawData] 按内容筛（子串匹配，查半年也只要 0.2 秒）。
 * 时间范围必须带：不带时平台从新到旧扫全部日志，没有日志的设备（离线、还没装好）要扫完整张表才返回，
 * 一次 5–40 秒（2026-10-20 实测），会把 Rust 层的 6 个连接名额占住，所有页面的请求都跟着排队。
 * 平台按时间倒序返回前 limit 条，这里返回按时间正序。
 */
export async function getHeartbeats(sn: string, range: [string, string], limit = 3000, deviceType?: number) {
  const slim = isSlim(deviceType);
  const res = await api.get<DeviceLog[]>("/api/device-log/pages", {
    params: { current: 1, pageSize: limit },
    filter: slim ? { sn, command: "post", rawData: "[10,", createdAt: range.join(",") } : { sn, command: "Device.heartbeat", createdAt: range.join(",") },
  });
  const out: Heartbeat[] = [];
  for (const row of res.data ?? []) {
    if (slim) {
      // 持续上报时一条里有两个采样，用各自的设备时间（平台每分钟给设备对一次时）
      for (const it of slimItems(row)) if (it[0] === 10 && it.length >= 5) out.push({ t: it[1] * 1000 || parseTime(row.createdAt), x: +it[2]!, y: +it[3]!, z: +it[4]! });
      continue;
    }
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

/** "最近心跳"往回查多远：再早的不查，按没有心跳处理 */
export const RECENT_HB_MS = 2 * 3600e3;
/** Ultra 系列的角度只在姿态变化时上报，最近一次角度要往回查得远一些 */
export const SLIM_ANGLE_LOOKBACK_MS = 180 * 86400e3;

/** from（毫秒）之后的最新 limit 条角度，默认查最近 2 小时；终点多留 1 分钟，免得本机时钟比平台慢时漏掉刚到的 */
export function getHeartbeatsSince(sn: string, from = Date.now() - RECENT_HB_MS, limit = 8, deviceType?: number) {
  return getHeartbeats(sn, [dayjs(from).format(LOG_FMT), dayjs().add(1, "minute").format(LOG_FMT)], limit, deviceType);
}

/**
 * Ultra 系列最近一次角度记在本机：查过到哪个时间、查到的角度。下次只查那之后的一段。
 * 平台按 rawData 子串筛时耗时和时间范围成正比（2026-10-23 藕塘社区实测：1 天 0.17 秒、7 天 0.6 秒、30 天 2.9 秒、
 * 半年 2.5–12 秒，没有角度的设备最慢），快速开始逐台查半年要几分钟。
 */
interface SlimAngleCache {
  /** 查到这个时间（本机时钟，毫秒）为止 */
  to: number;
  hb?: Heartbeat;
}
/** 往回多查一段，免得本机时钟比平台快时漏掉 */
const SLIM_ANGLE_OVERLAP_MS = 10 * 60e3;
const slimAngleKey = (sn: string) => `ops:slim-angle:${sn}`;

async function getLatestSlimAngle(sn: string, deviceType?: number) {
  let cached: SlimAngleCache | undefined;
  try {
    cached = JSON.parse(localStorage.getItem(slimAngleKey(sn)) ?? "null") ?? undefined;
  } catch {
    /* 读不到就从头查 */
  }
  const now = Date.now();
  const from = cached ? Math.max(cached.to - SLIM_ANGLE_OVERLAP_MS, now - SLIM_ANGLE_LOOKBACK_MS) : now - SLIM_ANGLE_LOOKBACK_MS;
  const list = await getHeartbeatsSince(sn, from, 1, deviceType);
  const hb = list[list.length - 1] ?? cached?.hb;
  try {
    localStorage.setItem(slimAngleKey(sn), JSON.stringify({ to: now, hb } satisfies SlimAngleCache));
  } catch {
    /* 存不了下次就再查一遍 */
  }
  return hb;
}

/** 最近一次角度：AIO 每分钟带一次，查最近 2 小时；Ultra 系列只在变化时报，查最近半年（本机记着查过的部分，见 getLatestSlimAngle） */
export async function getLatestAngle(sn: string, deviceType?: number) {
  if (isSlim(deviceType)) return getLatestSlimAngle(sn, deviceType);
  const list = await getHeartbeatsSince(sn, undefined, 8, deviceType);
  return list[list.length - 1];
}

export interface DeviceReport {
  /** 最近一次心跳（毫秒），判断在线用 */
  lastReportAt?: number;
  rssi?: number;
  /** 最近一次安装角度；AIO 就是最近一次心跳 */
  angle?: Heartbeat;
}

/**
 * 最近上报：心跳时间、信号、安装角度。AIO 三样都在同一条心跳里；
 * Ultra 系列的心跳 [3, …] 和信号 [1, …] 每一两分钟一条，角度另查（只在变化时报）。from 之后没有心跳时 lastReportAt 为空。
 */
export async function getDeviceReport(sn: string, deviceType?: number, from = Date.now() - RECENT_HB_MS): Promise<DeviceReport> {
  if (!isSlim(deviceType)) {
    const list = await getHeartbeatsSince(sn, from);
    const hb = list[list.length - 1];
    return hb ? { lastReportAt: hb.t, rssi: hb.rssi, angle: hb } : {};
  }
  const [res, angle] = await Promise.all([
    api.get<DeviceLog[]>("/api/device-log/pages", {
      params: { current: 1, pageSize: 10 },
      filter: { sn, command: "post", createdAt: [dayjs(from).format(LOG_FMT), dayjs().add(1, "minute").format(LOG_FMT)].join(",") },
    }),
    getLatestAngle(sn, deviceType),
  ]);
  const out: DeviceReport = { angle };
  // 平台的 command 筛选是子串匹配，post-hex（雷达原始帧）也会混进来，它同样是设备在上报；按时间倒序
  for (const row of res.data ?? []) {
    if (row.direction !== 1) continue;
    out.lastReportAt ??= parseTime(row.createdAt);
    if (out.rssi === undefined) for (const it of slimItems(row)) if (it[0] === 1 && typeof it[2] === "number") out.rssi = it[2];
  }
  return out;
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

/** 处理类型（各机构在"告警处理类型"里自定义，例如：有效告警 / 家属走动 / 误报 / 其他） */
export async function getProcessTypes() {
  return (await api.get<{ label: string; value: string }[]>("/api/alert-process-type/options")).data ?? [];
}

/** 处理告警（写操作，与网页端、用户端"处理告警"提交的内容一致）；处理后 alertStatus = 2，平台记下处理人和时间 */
export async function processAlert(id: string, alertProcessTypeId: string, processingResults: string) {
  await api.put("/api/alert/process", { id, alertProcessTypeId, processingResults });
}

/** 批量处理（网页端告警列表勾选后"批量处理"） */
export async function batchProcessAlerts(ids: string[], alertProcessTypeId: string, processingResults: string) {
  await api.put("/api/alert/batch-process", { ids, alertProcessTypeId, processingResults });
}

/** 告警处理类型（网页端 告警管理 › 处理类型，通用 CRUD /api/alert-process-type，按机构） */
export interface AlertProcessType {
  id: string;
  /** 必填 */
  alertProcessTypeName: string;
  /** 从小到大排序 */
  sortOrder?: number;
  /** 备注，≤ 200 字 */
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** 列表不带 description（2026-10-27 实测），备注只能逐条取详情 */
export async function listProcessTypes() {
  return (await api.get<AlertProcessType[]>("/api/alert-process-type/pages", { params: { current: 1, pageSize: 500 } })).data ?? [];
}

export async function getProcessType(id: string) {
  return (await api.get<AlertProcessType>("/api/alert-process-type", { params: { id } })).data;
}

export async function saveProcessType(t: Pick<AlertProcessType, "alertProcessTypeName" | "sortOrder" | "description"> & { id?: string }) {
  if (t.id) await api.put("/api/alert-process-type", t);
  else await api.post("/api/alert-process-type", t);
}

export async function deleteProcessType(id: string) {
  await api.del("/api/alert-process-type", { params: { id } });
}

// ---------- 设备属性（读取 / 下发） ----------

/** 1 String，2 Short，3 Int，4 Long，5 Float，6 Double，7 Bool，8 Array，9 Json */
export type PropertyDataType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface PropertyDef {
  propertyName: string;
  /** 报文里实际用的键（例如 net_ip 在报文里是 net_local_IP），没有时与 propertyName 相同 */
  aliasName?: string;
  title: string;
  propertyGroupStringCode?: string;
  dataType: PropertyDataType;
  /** 0 自定义，1 文本，2 输入框，3 多行，4 数字，5 开关，6 时间，7 下拉，8 音频，9 时间段 */
  displayType: number;
  /** 1 读写，2 只读，3 只写；没有时按读写 */
  accessMode?: number;
  /** 只存在平台、不下发到设备（例如提示音文件） */
  isPlatformOnly?: boolean;
  isBuiltIn?: boolean;
  isRequired?: boolean;
  unit?: string;
  description?: string;
  sortOrder?: number;
  fieldProps?: {
    openValue?: unknown;
    closeValue?: unknown;
    min?: number;
    max?: number;
    maxLength?: number;
    options?: { label: string; value: string | number }[];
    /** 显示条件，例如 talk_type_sel===1 */
    visibleExpression?: string;
    /** 时间段的格式："HH:mm-HH:mm"（字符串数组）或 "H,m"（每段 4 个数字的扁平数组） */
    timeRangeFormat?: string;
    timeRangeMaxCount?: number;
    /** 下拉可多选（值是数组） */
    multiple?: boolean;
  };
}

export interface PropertyGroup {
  stringCode: string;
  label: string;
}

/** 平台记录的属性值：最近一次下发（或读取保存）的值和下发状态 */
export interface StoredProperty {
  value: unknown;
  /** 1 下发中，2 成功，3 失败 */
  deliveryStatus?: number;
  deliveryAt?: string;
  deliveryError?: string;
  deliveryByUserName?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface PropertySchema {
  deviceTypeCode?: number;
  groups: PropertyGroup[];
  properties: PropertyDef[];
  values: Record<string, StoredProperty>;
}

interface RawSchema {
  deviceTypeCode?: number;
  groups?: { stringCode?: string; code?: number; label: string }[];
  properties?: PropertyDef[];
  values?: Record<string, StoredProperty>;
}

/**
 * 属性字典（按设备类型缓存）：中文标题、分组名，以及全部属性定义。
 * visibleScope（分组和属性都有）：1 全部可见，2 后台可见，3 全部隐藏。
 */
interface PropertyDict {
  titles: Map<string, string>;
  groups: Map<string, string>;
  /** 字典里的全部分组（不管可见范围），按平台顺序 */
  allGroups: PropertyGroup[];
  /** 字典里的全部属性定义 */
  all: (PropertyDef & { visibleScope?: number })[];
}

const dictCache = new Map<number, Promise<PropertyDict>>();

function getPropertyDict(deviceTypeCode: number) {
  let p = dictCache.get(deviceTypeCode);
  if (!p) {
    p = Promise.all([
      api.get<(PropertyDef & { visibleScope?: number })[]>("/api/device-type-property/list", { params: { deviceTypeCode } }),
      api.get<{ stringCode?: string; code?: number; label: string }[]>("/api/device-type-property/property-groups", { params: { deviceTypeCode } }),
    ]).then(([l, g]) => ({
      titles: new Map((l.data ?? []).map((x) => [x.propertyName, x.title])),
      groups: new Map((g.data ?? []).map((x) => [x.stringCode ?? String(x.code), x.label])),
      allGroups: (g.data ?? []).map((x) => ({ stringCode: x.stringCode ?? String(x.code), label: x.label })),
      all: l.data ?? [],
    }));
    p.catch(() => dictCache.delete(deviceTypeCode));
    dictCache.set(deviceTypeCode, p);
  }
  return p;
}

/** 这个型号能不能通话：属性字典里有呼叫方式 talk_type_sel（AIO 有，13 型跌倒终端没有） */
export async function supportsCall(deviceTypeCode?: number) {
  if (deviceTypeCode === undefined) return false;
  return (await getPropertyDict(deviceTypeCode)).titles.has("talk_type_sel");
}

/** raw-values 的一条：值按类型放在 jsonValue / intValue / stringValue / shortValue … 里 */
interface RawValue extends Omit<StoredProperty, "value"> {
  propertyName: string;
  [k: string]: unknown;
}

/**
 * 平台记录的全部值（GET /api/device-property/raw-values?deviceId=），包括隐藏分组里的属性；
 * 没有 deliveryError、updatedAt、updatedBy。找不到 deviceId 时返回空
 */
async function getRawValues(sn: string): Promise<Record<string, StoredProperty>> {
  const deviceId = await deviceIdOf(sn);
  if (!deviceId) return {};
  const list = (await api.get<RawValue[]>("/api/device-property/raw-values", { params: { deviceId } })).data ?? [];
  const out: Record<string, StoredProperty> = {};
  for (const r of list) {
    const key = Object.keys(r).find((k) => k.endsWith("Value"));
    out[r.propertyName] = {
      value: key ? r[key] : undefined,
      deliveryStatus: r.deliveryStatus,
      deliveryAt: r.deliveryAt,
      deliveryByUserName: r.deliveryByUserName,
    };
  }
  return out;
}

/** schema-values 的值（字段全，但去掉了隐藏的属性）盖在 raw-values（全部属性）上 */
function mergeValues(raw: Record<string, StoredProperty>, schema: Record<string, StoredProperty> | undefined) {
  return { ...raw, ...schema };
}

/**
 * 设备的属性定义 + 平台记录的值。
 * property-schema-values 返回的标题、分组名是英文（2026-10-16 换了几种语言请求头都一样），中文从属性字典取。
 * 平台按"设备类型属性分组配置"的可见范围去掉隐藏分组（例如 6 型"安装设置"设成全部隐藏，QL_radar_config 等就没了），
 * 定义和值都去掉；这里用属性字典把隐藏分组和里面的属性补回来（单个属性设成全部隐藏的仍不显示），
 * 值用 raw-values 补。隐藏只影响平台网页显示，下发、读取照常（2026-10-24 李虎 AIO雷达2 实测）。
 */
export async function getPropertySchema(sn: string): Promise<PropertySchema> {
  const [d, raw] = await Promise.all([
    api.get<RawSchema>("/api/device-property/property-schema-values", { params: { sn } }).then((r) => r.data ?? {}),
    getRawValues(sn).catch(() => ({})),
  ]);
  const dict = d.deviceTypeCode !== undefined ? await getPropertyDict(d.deviceTypeCode).catch(() => undefined) : undefined;
  const platformGroups = (d.groups ?? []).map((g) => g.stringCode ?? String(g.code));
  const platformProps = d.properties ?? [];
  // 只补平台去掉的分组里的属性；可见分组里平台没给的（iccid、imei 等）是平台别的规则去掉的，不动
  const hiddenGroups = new Set((dict?.allGroups ?? []).map((g) => g.stringCode).filter((c) => !platformGroups.includes(c)));
  const restored = (dict?.all ?? []).filter((p) => p.visibleScope !== 3 && p.propertyGroupStringCode !== undefined && hiddenGroups.has(p.propertyGroupStringCode));
  return {
    deviceTypeCode: d.deviceTypeCode,
    groups: dict
      ? dict.allGroups.filter((g) => platformGroups.includes(g.stringCode) || restored.some((p) => p.propertyGroupStringCode === g.stringCode))
      : (d.groups ?? []).map((g) => ({ stringCode: g.stringCode ?? String(g.code), label: g.label })),
    properties: [...platformProps, ...restored].map((p) => ({ ...p, title: dict?.titles.get(p.propertyName) ?? p.title })),
    values: mergeValues(raw, d.values),
  };
}

/** 只取平台记录的值（下发后刷新状态用），包括隐藏分组里的属性 */
export async function getStoredProperties(sn: string) {
  const [schema, raw] = await Promise.all([
    api.get<RawSchema>("/api/device-property/property-schema-values", { params: { sn } }).then((r) => r.data?.values),
    getRawValues(sn).catch(() => ({})),
  ]);
  return mergeValues(raw, schema);
}

/**
 * 下发读取指令（IOT.readproperty）。返回 seq，设备的应答从实时推送 DeviceResponse 回来（command = "get-property"）。
 * 平台网页端也兼容直接返回 {属性名: 值} 的情况，这里原样返回给调用方判断。
 */
export async function readDeviceProperties(sn: string, propertyNames: string[]) {
  return (await api.post<unknown>("/api/device-property/read", { sn, propertyNames })).data;
}

/**
 * 写属性（IOT.setproperty）。平台先保存为平台记录，saveOnly = false 时再下发到设备，返回 seq，
 * 设备应答从 DeviceResponse 回来（command = "set-property"）。只保存不下发、或全是平台属性时返回 -1。
 */
export async function writeDeviceProperties(sn: string, properties: { propertyName: string; value: unknown }[], saveOnly: boolean) {
  return (await api.post<unknown>("/api/device-property/write", { sn, properties, saveOnly })).data;
}

/** 机构里的全部设备（所有类型），选蓝牙外设、设备列表里的非雷达设备用 */
export interface AnyDevice {
  id: string;
  sn: string;
  deviceName?: string;
  deviceType: number;
  orgId?: string;
  orgName?: string;
  isOnline?: boolean;
  isDisabled?: boolean;
  firmwareVersion?: string;
  peripheralCount?: number;
}

export async function getAllDevices() {
  return (await api.get<AnyDevice[]>("/api/device/v4/management-pages", { params: { current: 1, pageSize: 5000 } })).data ?? [];
}

/** 实时推送 DeviceResponse：设备对读写指令的应答 */
export interface DeviceResponse {
  sn: string;
  command: "get-property" | "set-property" | string;
  seq?: string | number;
  /** 0 / 200 / 201 表示成功 */
  code?: number;
  message?: string;
  /** get-property 是 {属性名: 值}，get-tact 是场景列表 */
  data?: unknown;
}

export const isResponseOk = (code?: number) => code === 0 || code === 200 || code === 201;

/**
 * 下发一条读写指令并等设备应答：send 返回 seq，应答从实时推送 DeviceResponse 回来（按 sn + command + seq 对上），超时报错。
 * send 直接返回对象时当作数据本身（平台网页端也兼容这种情况）。应答没带 seq 时按 sn + command 认。
 */
export function awaitDeviceResponse<T>(sn: string, command: string, send: () => Promise<unknown>, timeoutMs = 30_000) {
  return new Promise<T>((resolve, reject) => {
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
    const matches = (r: DeviceResponse) => r.seq === undefined || r.seq === null || String(r.seq) === seq;
    const take = (r: DeviceResponse) =>
      finish(() => (isResponseOk(r.code) ? resolve(r.data as T) : reject(new Error(`${r.message || "设备返回错误"}（code ${r.code}）`))));
    const off = realtime.on("DeviceResponse", (payload) => {
      const r = payload as DeviceResponse;
      if (r?.sn !== sn || r.command !== command) return;
      if (seq === undefined) early.push(r);
      else if (matches(r)) take(r);
    });
    const timer = window.setTimeout(() => finish(() => reject(new Error("30 秒内设备没有应答，请确认设备在线"))), timeoutMs);
    send().then(
      (data) => {
        if (data && typeof data === "object") return finish(() => resolve(data as T));
        if (data === undefined || data === null || data === "") return finish(() => reject(new Error("指令没有返回序列号")));
        seq = String(data);
        const hit = early.find(matches);
        if (hit) take(hit);
      },
      (e) => finish(() => reject(e)),
    );
  });
}
