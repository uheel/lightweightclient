import { api } from "@radar/core";

/**
 * 护理人员与护理组（平台 基础管理 › 护理人员 / 护理员组，见 docs/site-analysis.md"护理人员与护理组"）。
 * 护理组把一批设备和一批护理员关联起来；一台设备、一位护理员都可以同时在几个组里。
 */

export interface Caregiver {
  id: string;
  realName: string;
  /** 编号，必填、不能重复；平台网页端的"二维码"就是这个编号 */
  code: string;
  /** 人员类型，字典 CAREGIVER_TYPE：1 护工，2 护士，3 医生 */
  type: number;
  /** 接听来电 */
  answerCall: boolean;
  phone?: string;
  /** 1 男，2 女 */
  gender?: number;
  age?: number;
  sortOrder?: number;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CaregiverGroup {
  id: string;
  groupName: string;
  description?: string;
  sortOrder?: number;
}

/** 组的成员（按组里的顺序）和设备，都是 id */
export interface GroupMembers {
  caregivers: string[];
  devices: string[];
}

/** 能加进护理组的设备（平台给的候选：当前机构的雷达） */
export interface GroupDevice {
  id: string;
  deviceName?: string;
  sn: string;
  deviceType?: number;
}

/** 字典返回的是英文名（网页端自己再翻译），这里直接用中文 */
export const CAREGIVER_TYPES = [
  { value: 1, label: "护工" },
  { value: 2, label: "护士" },
  { value: 3, label: "医生" },
];
export const caregiverTypeName = (t?: number) => CAREGIVER_TYPES.find((x) => x.value === t)?.label ?? (t === undefined ? "—" : `类型 ${t}`);

export async function listCaregivers() {
  return (await api.get<Caregiver[]>("/api/caregiver/pages", { params: { current: 1, pageSize: 5000 } })).data ?? [];
}

export async function getCaregiver(id: string) {
  return (await api.get<Caregiver>("/api/caregiver", { params: { id } })).data;
}

/** 修改是整份覆盖（没传的手机号、年龄、备注都会被清掉），调用方要带上全部字段。新增返回 id */
export async function saveCaregiver(c: Omit<Caregiver, "id" | "createdAt" | "updatedAt"> & { id?: string }) {
  if (c.id) {
    await api.put("/api/caregiver", c);
    return c.id;
  }
  return (await api.post<string>("/api/caregiver", c)).data;
}

/** 删除后平台自动把他移出所有护理组 */
export async function deleteCaregiver(id: string) {
  await api.del("/api/caregiver", { params: { id } });
}

export async function listGroups() {
  return (await api.get<CaregiverGroup[]>("/api/caregiver-group/pages", { params: { pagination: false } })).data ?? [];
}

export async function getGroup(id: string) {
  return (await api.get<CaregiverGroup>("/api/caregiver-group", { params: { id } })).data;
}

/** 新增返回 id */
export async function saveGroup(g: Omit<CaregiverGroup, "id"> & { id?: string }) {
  if (g.id) {
    await api.put("/api/caregiver-group", g);
    return g.id;
  }
  const d = (await api.post<string | { id: string }>("/api/caregiver-group", g)).data;
  return typeof d === "string" ? d : d.id;
}

export async function deleteGroup(id: string) {
  await api.del("/api/caregiver-group", { params: { id } });
}

/** 组的排序：按传入顺序写 1、2、3… */
export async function setGroupOrder(ids: string[]) {
  await api.put("/api/caregiver-group/batch-update-sort-order", { items: ids.map((id, i) => ({ id, sortOrder: i + 1 })) });
}

interface Row {
  id: string;
  /** 有值表示在这个组里 */
  groupId?: string;
  sortOrder?: number;
}

/**
 * 一个组的成员和设备。两个接口返回的都是全部候选（机构里的护理员 / 雷达），在组里的带 groupId；
 * 设备候选顺便带回去，省得再取一遍
 */
export async function getGroupMembers(groupId: string) {
  const [devs, users] = await Promise.all([
    api.get<(GroupDevice & Row)[]>("/api/caregiver-group/devices", { params: { groupId } }),
    api.get<Row[]>("/api/caregiver-group/users", { params: { groupId } }),
  ]);
  const inGroup = <T extends Row>(rows: T[] | undefined) => (rows ?? []).filter((x) => x.groupId);
  return {
    members: {
      caregivers: inGroup(users.data)
        .sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER))
        .map((x) => x.id),
      devices: inGroup(devs.data).map((x) => x.id),
    } satisfies GroupMembers,
    candidates: (devs.data ?? []).map(({ id, deviceName, sn, deviceType }) => ({ id, deviceName, sn, deviceType })),
  };
}

/** 整组覆盖：传组里应有的全部护理员，顺序就是组里的顺序 */
export async function setGroupCaregivers(groupId: string, caregiverIds: string[]) {
  await api.put("/api/caregiver-group/users", { groupId, caregiverIds });
}

/** 整组覆盖：传组里应有的全部设备 */
export async function setGroupDevices(groupId: string, deviceIds: string[]) {
  await api.put("/api/caregiver-group/devices", { groupId, deviceIds });
}
