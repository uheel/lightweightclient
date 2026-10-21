import dayjs from "dayjs";
import { api, realtime } from "@radar/core";
import type { PlanElement } from "./room";
import { installAreaOf, type InstallArea } from "../rooms/installArea";

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
  /** 房间外框，cm */
  background?: { width?: number; height?: number };
  buildingName?: string;
  floorName?: string;
  elements?: RoomElement[];
}

export interface RoomInfo {
  roomName: string;
  place: string;
  /** 房间外框尺寸，cm */
  size?: { width: number; height: number };
  /** sn → 安装配置 */
  configs: Map<string, QingLanConfig>;
  /** 布置里装着设备的雷达（一个房间可以有几台：卧室一台、卫生间一台） */
  radars: { sn: string; deviceName?: string; area?: InstallArea }[];
}

/** 房间详情：位置与每台雷达的安装配置（安装方式、方向、高度、工作模式） */
export async function getRoomInfo(roomId: string): Promise<RoomInfo> {
  const d = (await api.get<RoomDetail>("/api/room-view/v3/detail", { params: { roomId } })).data;
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
 * 心跳（约每分钟一次）。每次心跳日志里有两条记录，只有设备上报的那条带 install = [angle_x, angle_y, angle_z]。
 * 时间范围必须带：不带时平台从新到旧扫全部日志，没有日志的设备（离线、还没装好）要扫完整张表才返回，
 * 一次 5–40 秒（2026-10-20 实测），会把 Rust 层的 6 个连接名额占住，所有页面的请求都跟着排队。
 * 平台按时间倒序返回前 limit 条，这里返回按时间正序。
 */
export async function getHeartbeats(sn: string, range: [string, string], limit = 3000) {
  const res = await api.get<DeviceLog[]>("/api/device-log/pages", {
    params: { current: 1, pageSize: limit },
    filter: { sn, command: "Device.heartbeat", createdAt: range.join(",") },
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

/** "最近心跳"往回查多远：再早的不查，按没有心跳处理 */
export const RECENT_HB_MS = 2 * 3600e3;

/** from（毫秒）之后的最新 limit 条心跳，默认查最近 2 小时；终点多留 1 分钟，免得本机时钟比平台慢时漏掉刚到的 */
export function getHeartbeatsSince(sn: string, from = Date.now() - RECENT_HB_MS, limit = 8) {
  return getHeartbeats(sn, [dayjs(from).format(LOG_FMT), dayjs().add(1, "minute").format(LOG_FMT)], limit);
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

/** 属性字典的中文标题、分组名（按设备类型缓存） */
const dictCache = new Map<number, Promise<{ titles: Map<string, string>; groups: Map<string, string> }>>();

function getPropertyDict(deviceTypeCode: number) {
  let p = dictCache.get(deviceTypeCode);
  if (!p) {
    p = Promise.all([
      api.get<{ propertyName: string; title: string }[]>("/api/device-type-property/list", { params: { deviceTypeCode } }),
      api.get<{ stringCode?: string; code?: number; label: string }[]>("/api/device-type-property/property-groups", { params: { deviceTypeCode } }),
    ]).then(([l, g]) => ({
      titles: new Map((l.data ?? []).map((x) => [x.propertyName, x.title])),
      groups: new Map((g.data ?? []).map((x) => [x.stringCode ?? String(x.code), x.label])),
    }));
    p.catch(() => dictCache.delete(deviceTypeCode));
    dictCache.set(deviceTypeCode, p);
  }
  return p;
}

/**
 * 设备的属性定义 + 平台记录的值（GET /api/device-property/property-schema-values）。
 * 这个接口返回的标题、分组名是英文（2026-10-16 换了几种语言请求头都一样），中文从属性字典 /api/device-type-property/list 取。
 * 平台已经去掉了隐藏的属性。
 */
export async function getPropertySchema(sn: string): Promise<PropertySchema> {
  const d = (await api.get<RawSchema>("/api/device-property/property-schema-values", { params: { sn } })).data ?? {};
  const dict = d.deviceTypeCode !== undefined ? await getPropertyDict(d.deviceTypeCode).catch(() => undefined) : undefined;
  return {
    deviceTypeCode: d.deviceTypeCode,
    groups: (d.groups ?? []).map((g) => {
      const code = g.stringCode ?? String(g.code);
      return { stringCode: code, label: dict?.groups.get(code) ?? g.label };
    }),
    properties: (d.properties ?? []).map((p) => ({ ...p, title: dict?.titles.get(p.propertyName) ?? p.title })),
    values: d.values ?? {},
  };
}

/** 只取平台记录的值（下发后刷新状态用） */
export async function getStoredProperties(sn: string) {
  return (await api.get<RawSchema>("/api/device-property/property-schema-values", { params: { sn } })).data?.values ?? {};
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

/** 机构里的全部设备（所有类型），选蓝牙外设用 */
export interface AnyDevice {
  id: string;
  sn: string;
  deviceName?: string;
  deviceType: number;
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
