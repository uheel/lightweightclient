import { api, findOrg, getOrgTree, session } from "@radar/core";

/**
 * 管理主机（deviceType 3）：自己注册到 SIP 服务器，和雷达双向通话。
 * 接口和下发协议见 docs/site-analysis.md"管理主机与 SIP 通话"。
 */

export const MASTER_TYPE = 3;

type Org = { orgId: string; orgType: number };
let orgTree: ReturnType<typeof getOrgTree> | undefined;

/**
 * 主机相关的房间接口按请求头的机构取数据：在平台或上级机构下看别的机构的主机时，房间树是空的。
 * 所以这些请求固定用主机所属机构发（orgType 从机构树查，查不到按普通机构 2）
 */
async function orgOf(m: { orgId: string }): Promise<Org | undefined> {
  if (!m.orgId || session.get()?.orgId === m.orgId) return undefined;
  orgTree ??= getOrgTree().catch(() => []);
  const node = findOrg(await orgTree, m.orgId);
  return { orgId: m.orgId, orgType: node ? Number(node.orgType) : 2 };
}

/** 主机可选的房间树：楼栋 › 楼层 › 房间，房间是叶子（key = 房间 id） */
export interface RoomTreeNode {
  key: string;
  title: string;
  isLeaf?: boolean;
  children?: RoomTreeNode[];
}

export async function getMasterRoomTree(m: { id: string; orgId: string }) {
  return (await api.get<RoomTreeNode[]>("/api/room/room-tree", { params: { deviceId: m.id }, org: await orgOf(m) })).data ?? [];
}

/** 管理主机列表（/api/device/v3/master-pages），比全类型列表多 SIP 和 IP 字段 */
export interface Master {
  id: string;
  sn: string;
  deviceName: string;
  deviceType: number;
  orgId: string;
  orgName: string;
  isOnline: boolean;
  isDisabled: boolean;
  firmwareVersion?: string;
  ipAddress?: string;
  sipEnable?: boolean;
  sipServer?: string;
  sipUserName?: string;
  isSipRegister?: boolean;
  sipRegisterAt?: string;
  /** 2 = SIP 账号已下发到主机 */
  sipIssueStatus?: number;
  sipIssueAt?: string;
  /** 通讯录里的雷达数 */
  deviceCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export async function getMasters() {
  return (await api.get<Master[]>("/api/device/v3/master-pages", { params: { current: 1, pageSize: 5000 } })).data ?? [];
}

/** 主机覆盖的房间（房间 id） */
export async function getMasterRoomKeys(m: { id: string; orgId: string }) {
  return (await api.get<string[]>("/api/master/room-keys", { params: { deviceId: m.id }, org: await orgOf(m) })).data ?? [];
}

/** 保存覆盖的房间；issued = true 时平台同时把这些房间里的雷达作为通讯录下发给主机（update.devices） */
export async function saveMasterRoomKeys(m: { id: string; sn: string; orgId: string }, roomKeys: string[], issued: boolean) {
  await api.post("/api/master/room-keys", { deviceId: m.id, sn: m.sn, roomKeys, issued }, { org: await orgOf(m) });
}

/** 通讯录里的一台雷达（平台按覆盖的房间生成，下发给主机的就是这份） */
export interface MasterContact {
  deviceId: string;
  roomName?: string;
  deviceName?: string;
  sn: string;
  realName?: string;
  deviceType?: number;
  ip?: string;
  /** 雷达的 SIP 号，主机拨这个号 */
  callNum?: string;
  sipAccount?: string;
  /** 雷达的呼叫方式：0 局域网 / 1 云对讲 */
  callType?: number;
}

/** 按当前保存的房间，平台将下发给主机的通讯录 */
export async function getMasterContacts(m: { id: string; orgId: string }) {
  return (await api.get<MasterContact[]>("/api/device/v4/master/issue-devices-preview", { params: { deviceId: m.id }, org: await orgOf(m) })).data ?? [];
}

// ---------- 雷达一侧：所属管理主机、SIP 号 ----------

/** 雷达可选的管理主机 */
export interface MasterOption {
  id: string;
  deviceName?: string;
  sn: string;
  ipAddress?: string;
  sipUserName?: string;
  sipServer?: string;
  /** 主机的覆盖房间里有雷达所在的房间（主机通讯录里有这台雷达） */
  covers: boolean;
}

/**
 * 机构里的管理主机（/api/master/available-list），标出哪些覆盖了雷达所在的房间。
 * 平台网页端的"所属管理主机"只给 /api/master/info?deviceId=雷达 的结果，那只是已经覆盖这个房间的主机（2026-10-22 实测），
 * 而且 available-list 不一定带 SIP 号，用 info 的补上
 */
export async function getMasterOptions(radar: { id: string; orgId: string }): Promise<MasterOption[]> {
  const org = await orgOf(radar);
  const [all, covering] = await Promise.all([
    api.get<Omit<MasterOption, "covers">[]>("/api/master/available-list", { org }).then((r) => r.data ?? []),
    api.get<Omit<MasterOption, "covers">[]>("/api/master/info", { params: { deviceId: radar.id }, org }).then((r) => r.data ?? []),
  ]);
  const byId = new Map(covering.map((m) => [m.id, m]));
  const list = all.map((m) => ({ ...m, ...byId.get(m.id), covers: byId.has(m.id) }));
  for (const m of covering) if (!list.some((x) => x.id === m.id)) list.push({ ...m, covers: true });
  return list;
}

/** 把一个房间加进主机的覆盖房间并下发通讯录 */
export async function addRoomToMaster(m: { id: string; sn: string; orgId: string }, roomId: string) {
  const keys = await getMasterRoomKeys(m);
  if (!keys.includes(roomId)) await saveMasterRoomKeys(m, [...keys, roomId], true);
}

/**
 * 雷达通话配置（平台记录）。call 里是设备属性的报文键：talk_type_sel（0 局域网 / 1 云对讲）、talk_master_number（紧急号码）、
 * talk_local_number / talk_auth_pass / talk_sip_server（雷达自己的 SIP 账号）等；平台只存改过的，常常只有 talk_sip_server
 */
export interface RadarCallConfig {
  masterId?: string;
  call?: Record<string, unknown>;
}

export async function getRadarCallConfig(radar: { id: string; orgId: string }) {
  return (await api.get<RadarCallConfig>("/api/device-config/call", { params: { deviceId: radar.id }, org: await orgOf(radar) })).data ?? {};
}

/** 平台分配一个空闲的 SIP 账号（平台网页端"随机选择 SIP"），保存通话配置时才真正绑给雷达 */
export async function getAvailableSip(radar: { orgId: string }) {
  return (await api.get<{ sipAccount?: string; sipPassword?: string }>("/api/device-sip/available", { org: await orgOf(radar) })).data ?? {};
}

/**
 * 保存雷达通话配置并下发（PUT /api/device-config/call，和平台网页端"保存并下发"一样）。
 * 平台和自己的记录比，只把变了的属性用 IOT.setproperty 下发；返回 seq，没有变化时返回 0
 */
export async function saveRadarCallConfig(radar: { id: string; sn: string; orgId: string }, cfg: { masterId?: string | null; call: Record<string, unknown> }) {
  return (await api.put<number>("/api/device-config/call", { ...cfg, sn: radar.sn, deviceId: radar.id }, { org: await orgOf(radar) })).data;
}

/** 通话记录 */
export interface CallRecord {
  id: string;
  callType?: number;
  callerDeviceName?: string;
  callerSn?: string;
  callerIdentifier?: string;
  callerDeviceType?: number;
  callerRoomName?: string;
  callerRangeName?: string;
  calleeDeviceName?: string;
  calleeSn?: string;
  calleeNumber?: string;
  /** 实际拨的地址：云对讲是 号码@SIP服务器，局域网是 号码@主机IP */
  rawCalleeNumber?: string;
  calleeIdentifier?: string;
  calleeDeviceType?: number;
  calleeRoomName?: string;
  calleeRangeName?: string;
  /** 1 正常接听 / 2 占线 / 3 未接 / 4 拒接 */
  status?: number;
  startAt?: string;
  elapsedSeconds?: number;
  audioFile?: string;
}

export const CALL_STATUS: Record<number, { text: string; color: string }> = {
  1: { text: "正常接听", color: "green" },
  2: { text: "占线", color: "lime" },
  3: { text: "未接", color: "orange" },
  4: { text: "拒接", color: "red" },
};

/** 设备所属机构最近的通话记录（平台的 deviceId 参数不起作用，按设备筛选在客户端做） */
export async function getCallRecords(d: { orgId: string }, max = 1000) {
  return (await api.getAll<CallRecord>("/api/call-record/pages", { pageSize: 500, max, org: await orgOf(d) })).data ?? [];
}
