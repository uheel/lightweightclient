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
