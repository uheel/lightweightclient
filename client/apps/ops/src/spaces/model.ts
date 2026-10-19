import type { Radar } from "../api/device";
import type { Room } from "../api/room";
import type { BedRow, Building, Floor } from "../api/space";
import { byName } from "./names";

/** 楼宇页一次取回的数据，之后的分组、统计、删除前的影响范围都在本地算 */
export interface Spaces {
  buildings: Building[];
  floors: Floor[];
  rooms: Room[];
  beds: BedRow[];
  radars: Radar[];
}

export interface Tally {
  floors: number;
  rooms: number;
  beds: number;
  /** 已入住的床位 */
  occupied: BedRow[];
  /** 绑在这些房间上的雷达 */
  radars: number;
  /** 绑在这些床位上的设备 */
  bedDevices: number;
}

export interface SpaceIndex {
  buildings: Building[];
  floorsOf: Map<string, Floor[]>;
  roomsOf: Map<string, Room[]>;
  bedsOf: Map<string, BedRow[]>;
  radarsOf: Map<string, Radar[]>;
  building: Map<string, Building>;
  floor: Map<string, Floor>;
  room: Map<string, Room>;
}

function group<T>(list: T[], key: (x: T) => string | undefined, sort: (a: T, b: T) => number) {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    if (!k) continue;
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  for (const arr of m.values()) arr.sort(sort);
  return m;
}

export function indexSpaces(d: Spaces): SpaceIndex {
  return {
    buildings: [...d.buildings].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || byName(a.buildingName, b.buildingName)),
    floorsOf: group(d.floors, (f) => f.buildingId, (a, b) => (a.floorNumber ?? 0) - (b.floorNumber ?? 0) || byName(a.floorName, b.floorName)),
    roomsOf: group(d.rooms, (r) => r.floorId, (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || byName(a.roomName, b.roomName)),
    bedsOf: group(d.beds, (b) => b.roomId, (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || byName(a.bedName, b.bedName)),
    radarsOf: group(d.radars, (r) => r.roomId, (a, b) => byName(a.deviceName, b.deviceName)),
    building: new Map(d.buildings.map((x) => [x.id, x])),
    floor: new Map(d.floors.map((x) => [x.id, x])),
    room: new Map(d.rooms.map((x) => [x.id, x])),
  };
}

/** 一组房间下面挂着什么：删除前用来提示影响范围 */
export function tallyRooms(ix: SpaceIndex, rooms: Room[], floors = 0): Tally {
  const beds = rooms.flatMap((r) => ix.bedsOf.get(r.id) ?? []);
  return {
    floors,
    rooms: rooms.length,
    beds: beds.length,
    occupied: beds.filter((b) => b.bedStatus === 2 || !!b.realName),
    radars: rooms.reduce((n, r) => n + (ix.radarsOf.get(r.id)?.length ?? 0), 0),
    bedDevices: beds.reduce((n, b) => n + (b.deviceCount ?? 0), 0),
  };
}

export function roomsOfFloor(ix: SpaceIndex, floorId: string) {
  return ix.roomsOf.get(floorId) ?? [];
}

export function roomsOfBuilding(ix: SpaceIndex, buildingId: string) {
  return (ix.floorsOf.get(buildingId) ?? []).flatMap((f) => roomsOfFloor(ix, f.id));
}

/** 删除后在本地去掉：楼栋 / 楼层 / 房间连带下面的东西，绑在那些房间上的雷达改成未绑定 */
export function without(d: Spaces, kill: { buildings?: string[]; floors?: string[]; rooms?: string[]; beds?: string[] }): Spaces {
  const b = new Set(kill.buildings);
  const f = new Set([...(kill.floors ?? []), ...d.floors.filter((x) => b.has(x.buildingId)).map((x) => x.id)]);
  const r = new Set([...(kill.rooms ?? []), ...d.rooms.filter((x) => x.floorId && f.has(x.floorId)).map((x) => x.id)]);
  const bed = new Set(kill.beds);
  return {
    buildings: d.buildings.filter((x) => !b.has(x.id)),
    floors: d.floors.filter((x) => !f.has(x.id)),
    rooms: d.rooms.filter((x) => !r.has(x.id)),
    beds: d.beds.filter((x) => !bed.has(x.id) && !r.has(x.roomId)),
    radars: d.radars.map((x) => (x.roomId && r.has(x.roomId) ? { ...x, roomId: undefined, roomName: undefined } : x)),
  };
}
