import { api } from "@radar/core";
import { getRoomDesign, getRooms, saveRoomDesign, type PlanElement, type Room } from "./room";

/**
 * 楼栋 / 楼层 / 房间 / 床位的增删改（见 docs/site-analysis.md"楼栋、楼层、房间、床位的增删改"）。
 * 注意：平台的删除是级联的（删楼栋会删掉下面所有楼层、房间、床位、入住记录并解绑设备），
 * 床位删除还不核对名字，调用方删除前一定要先在本地查清楚下面挂着什么。
 */

export interface Building {
  id: string;
  buildingName: string;
  buildingNum?: string;
  description?: string;
  sortOrder?: number;
}

export interface Floor {
  id: string;
  buildingId: string;
  floorName: string;
  floorNumber?: number;
  description?: string;
}

export interface BedRow {
  id: string;
  bedName: string;
  bedNumber?: number;
  roomId: string;
  floorId?: string;
  buildingId?: string;
  /** 1 空闲，2 已入住 */
  bedStatus?: number;
  realName?: string;
  deviceCount?: number;
  sortOrder?: number;
}

/** 删除接口返回影响条数：0 表示没删（名字不对或记录已经不在） */
function affected(n: number | undefined, what: string) {
  if (!n) throw new Error(`${what}没有删除，可能已经被删掉了，刷新一下再看`);
}

const PAGE = { pageSize: 500, max: 20_000 };

/** 当前机构的楼栋、楼层、房间、床位，一次取完（平台列表里的统计数不准，数量都在本地算） */
export async function getSpaces() {
  const [buildings, floors, rooms, beds] = await Promise.all([
    api.getAll<Building>("/api/building/pages", PAGE).then((r) => r.data ?? []),
    api.getAll<Floor>("/api/floor/pages", PAGE).then((r) => r.data ?? []),
    getRooms(),
    api.getAll<BedRow>("/api/bed/pages", PAGE).then((r) => r.data ?? []),
  ]);
  return { buildings, floors, rooms, beds };
}

// ---------- 楼栋 ----------

export async function createBuilding(buildingName: string) {
  return (await api.post<string>("/api/building", { buildingName })).data!;
}

/** 修改要整条记录带回，先取一次 */
export async function renameBuilding(id: string, buildingName: string) {
  const rec = (await api.get<Building>("/api/building", { params: { id } })).data;
  if (!rec) throw new Error("楼栋记录读不到");
  await api.put("/api/building", { ...rec, buildingName });
}

/** 级联删除下面的楼层、房间、床位，并解绑设备 */
export async function deleteBuilding(b: Building) {
  affected((await api.del<number>("/api/building", { params: { id: b.id, name: b.buildingName } })).data, "楼栋");
}

// ---------- 楼层 ----------

/** 楼层号、楼层名在楼栋内都唯一；楼层号范围 -5～99 */
export async function createFloor(buildingId: string, floorName: string, floorNumber: number) {
  return (await api.post<string>("/api/floor", { buildingId, floorName, floorNumber })).data!;
}

export async function updateFloor(id: string, patch: { floorName?: string; floorNumber?: number }) {
  const rec = (await api.get<Floor>("/api/floor", { params: { id } })).data;
  if (!rec) throw new Error("楼层记录读不到");
  await api.put("/api/floor", { ...rec, ...patch });
}

/** 级联删除下面的房间、床位，并解绑设备 */
export async function deleteFloor(f: Floor) {
  affected((await api.del<number>("/api/floor", { params: { id: f.id, name: f.floorName } })).data, "楼层");
}

// ---------- 房间 ----------

/** 客户端建房用的共用空白户型（客户看不到）。平台建房必须带户型，户型只在建房时拷贝一次，之后只是个标签 */
const BLANK_TYPE = "通用";
let blankType: { orgKey: string; id: string } | undefined;

async function blankRoomTypeId(orgKey: string) {
  if (blankType?.orgKey === orgKey) return blankType.id;
  const list = (await api.get<{ label: string; value: string }[]>("/api/room-type/options")).data ?? [];
  const id = list.find((x) => x.label === BLANK_TYPE)?.value ?? (await api.post<string>("/api/room-type", { roomTypeName: BLANK_TYPE, roomLong: 4, roomWidth: 4 })).data!;
  blankType = { orgKey, id };
  return id;
}

/** 房间布置里去掉设备绑定，雷达变成空位置（之后绑上的雷达会放进这个位置，和平台户型一样） */
function unbound(list?: PlanElement[]): PlanElement[] | undefined {
  return list?.map(({ sn: _sn, deviceId: _id, deviceName: _name, ...e }) => ({ ...e, children: unbound(e.children) }));
}

export interface NewRoom {
  buildingId: string;
  floorId: string;
  roomName: string;
  /** 米：宽 = 平面图水平方向，长 = 垂直方向；照着别的房间布置时用那间的尺寸 */
  width: number;
  long: number;
  /** 照着这间房的布置（家具、区域、雷达位置）；雷达只拷安装和区域，不拷设备绑定 */
  copyFrom?: string;
  /** 要建的床位名 */
  beds: string[];
}

/**
 * 建一间房：挂在共用空白户型上建房 → 按填的尺寸改（平台建房时用户型的尺寸）或拷布置 → 逐个建床。
 * orgKey 用来区分机构（共用户型的 id 按机构缓存）。
 */
export async function createRoom(orgKey: string, r: NewRoom) {
  const roomTypeId = await blankRoomTypeId(orgKey);
  const created = (
    await api.post<{ id: string }>("/api/room/v3/apply-room-type-on-create", {
      roomName: r.roomName,
      floorId: r.floorId,
      buildingId: r.buildingId,
      roomTypeId,
      roomLong: r.long,
      roomWidth: r.width,
      autoCreateBeds: false,
    })
  ).data;
  if (!created?.id) throw new Error("平台没有返回房间 id");
  const id = created.id;
  const src = r.copyFrom ? await getRoomDesign(r.copyFrom) : undefined;
  if (src?.roomStyle) await saveRoomDesign(id, { roomStyle: { ...src.roomStyle }, elements: unbound(src.elements) ?? [] });
  else await setRoomSize(id, r.width, r.long);
  // 床位号在楼层内唯一，不填床位号（可以为空），只用名字
  for (const bedName of r.beds) await createBed(id, bedName);
  return id;
}

export async function renameRoom(id: string, roomName: string) {
  const rec = (await api.get<Room & { id: string }>("/api/room", { params: { id } })).data;
  if (!rec) throw new Error("房间记录读不到");
  await api.put("/api/room", { ...rec, roomName });
}

/** 改尺寸（米），布置里的外框跟着改，家具和区域不动 */
export async function setRoomSize(roomId: string, width: number, long: number) {
  await api.put("/api/room/v3/size", { roomId, roomWidth: width, roomLong: long });
}

/** 删除房间：同时删床位、入住记录，并解绑设备 */
export async function deleteRoom(r: Room) {
  affected((await api.del<number>("/api/room", { params: { id: r.id, name: r.roomName } })).data, "房间");
}

// ---------- 床位 ----------

export async function createBed(roomId: string, bedName: string) {
  return (await api.post<string>("/api/bed", { roomId, bedName })).data!;
}

export async function renameBed(id: string, bedName: string) {
  const rec = (await api.get<BedRow>("/api/bed", { params: { id } })).data;
  if (!rec) throw new Error("床位记录读不到");
  await api.put("/api/bed", { ...rec, bedName });
}

/** 平台删床位不核对名字，调用方先确认没人入住 */
export async function deleteBed(b: BedRow) {
  affected((await api.del<number>("/api/bed", { params: { id: b.id, name: b.bedName } })).data, "床位");
}
