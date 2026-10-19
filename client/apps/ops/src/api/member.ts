import { api } from "@radar/core";

/**
 * 长者（平台界面叫"用户"）建档与入住。
 * 注意：平台按手机号识别长者。POST /api/member 时手机号已存在，平台不会新建也不会改资料，而是返回已有那位长者的 id
 * （2026-10-15 实测，那位长者可能属于别的机构）。所以导入前先按手机号查，导入后再核对返回的是不是同一个人。
 */

export interface CodeOption {
  label: string;
  value: string;
}

/** 平台代码字典，例如 ID_TYPE（证件类型）、HEALTH_STATUS（老人分类） */
export async function getCodes(codeType: string) {
  return (await api.get<CodeOption[]>("/sapi/code/options", { params: { codeType } })).data ?? [];
}

export interface Bed {
  bedId: string;
  bedName: string;
  roomName: string;
  building: string;
  floor: string;
  /** 已入住的长者 */
  memberId?: string;
  realName?: string;
}

interface Option {
  label: string;
  value: string;
}

/** 当前机构全部床位：楼栋 → 楼层 → 床位（options-with-floor 必须带楼栋和楼层） */
export async function getAllBeds() {
  const buildings = (await api.get<Option[]>("/api/building/options")).data ?? [];
  const out: Bed[] = [];
  await Promise.all(
    buildings.map(async (b) => {
      const floors = (await api.get<Option[]>("/api/floor/options", { params: { buildingId: b.value } })).data ?? [];
      await Promise.all(
        floors.map(async (f) => {
          const beds =
            (await api.get<Omit<Bed, "building" | "floor">[]>("/api/bed/options-with-floor", { params: { buildingId: b.value, floorId: f.value } })).data ?? [];
          for (const x of beds) out.push({ ...x, building: b.label, floor: f.label });
        }),
      );
    }),
  );
  const key = (x: Bed) => `${x.building}\u0000${x.floor}\u0000${x.roomName}\u0000${x.bedName}`;
  return out.sort((a, b) => key(a).localeCompare(key(b), "zh-CN", { numeric: true }));
}

export interface MemberHit {
  memberId: string;
  realName: string;
  phoneNumber?: string;
  /** 1 已登记，2 已入住 */
  checkType?: number;
}

/**
 * 按手机号在当前机构里找长者。
 * /api/member/search 只返回"已登记未入住"的，不能用；列表接口按 filter[phoneNumber] 能查到全部，
 * 但返回的手机号是打码的，所以再取详情核对完整号码。
 */
export async function findMemberByPhone(phone: string): Promise<MemberHit | undefined> {
  const list =
    (await api.get<{ id: string; realName: string; checkType?: number }[]>("/api/member/pages", { params: { current: 1, pageSize: 20 }, filter: { phoneNumber: phone } }))
      .data ?? [];
  for (const m of list) {
    const d = await getMember(m.id);
    if (d?.phoneNumber === phone) return { memberId: m.id, realName: m.realName, phoneNumber: phone, checkType: m.checkType };
  }
  return undefined;
}

export interface NewMember {
  realName: string;
  phoneNumber: string;
  /** 1 男，2 女 */
  gender?: number;
  age?: number;
  /** YYYY-MM-DD */
  birthDate?: string;
  /** ID_TYPE：1 身份证… */
  idType?: number;
  idNumber?: string;
  /** HEALTH_STATUS 老人分类 */
  memberType?: number;
  height?: number;
  weight?: number;
  address?: string;
}

/** 建档，返回长者 id（手机号已存在时返回的是已有长者的 id） */
export async function createMember(m: NewMember) {
  return (await api.post<string>("/api/member", m)).data;
}

export async function getMember(id: string) {
  return (await api.get<{ id: string; realName: string; phoneNumber?: string; bedId?: string }>("/api/member", { params: { id } })).data;
}

/** 办理入住，date 为 YYYY-MM-DD */
export async function checkIn(memberId: string, bedId: string, date: string) {
  await api.put("/api/member/check-in", { memberId, bedId, date });
}

// ---------- 长者管理（见 docs/site-analysis.md"入住、调床、退住、设备关联、亲友"） ----------

/** 长者列表一行。注意：这里的楼栋 / 房间 / 床位是办入住时的那张床，调床后不更新，位置以床位一侧（getAllBeds）为准 */
export interface MemberRow {
  id: string;
  realName: string;
  /** 打码的手机号 */
  phoneNumber?: string;
  gender?: number;
  age?: number;
  birthDate?: string;
  /** 1 已登记，2 已入住，3 已退住 */
  checkType?: number;
  checkInAt?: string;
  deviceCount?: number;
  createdAt?: string;
}

/** 当前机构全部长者（含亲友：加亲友也会建一条长者记录） */
export async function getMembers() {
  return (await api.getAll<MemberRow>("/api/member/pages", { pageSize: 500, max: 20_000 })).data ?? [];
}

/** 长者详情（只返回有值的字段；手机号不打码） */
export interface MemberDetail extends Partial<NewMember> {
  id: string;
  realName: string;
  bedId?: string;
  [k: string]: unknown;
}

export async function getMemberDetail(id: string) {
  return (await api.get<MemberDetail>("/api/member", { params: { id } })).data;
}

/** 改资料：整条记录带回 */
export async function updateMember(id: string, patch: Partial<NewMember>) {
  const rec = await getMemberDetail(id);
  if (!rec) throw new Error("长者记录读不到");
  await api.put("/api/member", { ...rec, ...patch });
}

/** 从本机构移除。平台不核对名字，也不管是否已入住（没退住就删会在床上留下"幽灵"），调用方先确认已退住 */
export async function deleteMember(id: string, realName: string) {
  const n = (await api.del<number>("/api/member", { params: { id, name: realName } })).data;
  if (!n) throw new Error("没有删除，可能已经被删掉了");
}

/** 调床：只能调到空床（平台不拦有人的床，会把原来的人挤掉） */
export async function adjustBed(memberId: string, bedId: string, description?: string) {
  await api.put("/api/member/bed-adjust", { memberId, bedId, description });
}

/** 两位已入住的长者对调床位 */
export async function swapBed(memberId: string, swapMemberId: string, description?: string) {
  await api.put("/api/member/bed-swap", { memberId, swapMemberId, description });
}

export const CHECKOUT_REASONS = [
  { value: 1, label: "回家" },
  { value: 2, label: "转院" },
  { value: 3, label: "死亡" },
  { value: 4, label: "其他" },
];

export async function checkOut(memberId: string, checkOutReason: number, description?: string) {
  await api.put("/api/member/check-out", { memberId, checkOutReason, description });
}

// ---------- 长者关联的设备 ----------

export interface MemberDevice {
  deviceId: string;
  sn: string;
  deviceName?: string;
  deviceType?: number;
  /** 候选列表里：已归属的长者 */
  owners?: { memberId: string; memberName: string }[];
}

export async function getMemberDevices(memberId: string) {
  return (await api.get<MemberDevice[]>("/api/device-position/v3/member-devices", { params: { memberId } })).data ?? [];
}

export async function getMemberDeviceCandidates(memberId: string) {
  return (await api.get<MemberDevice[]>("/api/device-position/v3/member-device-candidates", { params: { memberId } })).data ?? [];
}

/** 一台设备只归属一位长者；已归属别人时要 transfer = true 才转过来 */
export async function bindMemberDevice(memberId: string, deviceId: string, transfer = false) {
  await api.put("/api/device-position/v3/bind-member-device", { memberId, deviceId, confirmTransfer: transfer });
}

export async function unbindMemberDevice(memberId: string, deviceId: string) {
  await api.put("/api/device-position/v3/unbind-member-device", { memberId, deviceId });
}

// ---------- 亲友 ----------

export interface Relative {
  memberId: string;
  realName: string;
  phoneNumber?: string;
  relationshipType?: number;
  isAdmin?: boolean;
}

export async function getRelatives(memberId: string) {
  return (await api.get<Relative[]>("/api/member/relatives/pages", { params: { current: 1, pageSize: 100 }, filter: { memberId } })).data ?? [];
}

/** 加亲友：平台按手机号在本机构建（或找到）一条长者记录，再建立关系 */
export async function addRelative(memberId: string, r: { realName: string; phoneNumber?: string; relationshipType: number }) {
  await api.post("/api/member/relatives", { memberId, ...r, relationshipType: String(r.relationshipType) });
}

/** 只解除关系，亲友那条长者记录还在 */
export async function removeRelative(memberId: string, relatedMemberId: string) {
  await api.del("/api/member/relatives", { params: { memberId, relatedMemberId } });
}
