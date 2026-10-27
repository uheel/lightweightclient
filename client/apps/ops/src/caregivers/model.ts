import type { GroupDevice } from "../api/caregiver";
import type { Radar } from "../api/device";
import type { Room } from "../api/room";

/** 设备在楼宇里的位置；没绑房间的放在"未绑房间" */
export interface DeviceSpot {
  device: GroupDevice;
  building: string;
  floor: string;
  room: string;
  /** 楼栋、楼层、房间的排序键 */
  sort: [number, number, string];
}

export const NO_ROOM = "未绑房间";

const byName = (a: string, b: string) => a.localeCompare(b, "zh-CN", { numeric: true });

/** 用快速开始已经取回的雷达和房间给设备定位，不另外请求 */
export function locateDevices(devices: GroupDevice[], radars: Radar[] = [], rooms: Room[] = []): Map<string, DeviceSpot> {
  const roomOf = new Map(radars.map((r) => [r.id, r.roomId]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  return new Map(
    devices.map((d) => {
      const r = roomById.get(roomOf.get(d.id) ?? "");
      const spot: DeviceSpot = r
        ? { device: d, building: r.buildingName ?? "", floor: r.floorName ?? "", room: r.roomName, sort: [r.buildingSortOrder ?? 0, r.floorNumber ?? 0, r.roomName] }
        : { device: d, building: "", floor: "", room: NO_ROOM, sort: [Number.MAX_SAFE_INTEGER, 0, ""] };
      return [d.id, spot];
    }),
  );
}

export function compareSpots(a: DeviceSpot, b: DeviceSpot) {
  return (
    a.sort[0] - b.sort[0] ||
    byName(a.building, b.building) ||
    a.sort[1] - b.sort[1] ||
    byName(a.floor, b.floor) ||
    byName(a.sort[2], b.sort[2]) ||
    byName(a.device.deviceName ?? a.device.sn, b.device.deviceName ?? b.device.sn)
  );
}

export const floorLabel = (s: DeviceSpot) => (s.room === NO_ROOM ? NO_ROOM : [s.building, s.floor].filter(Boolean).join(" · ") || "未分楼层");
export const deviceLabel = (d: GroupDevice) => d.deviceName || d.sn;

/** 按"楼栋 · 楼层"再按房间分好组，给列表显示 */
export function groupByFloor(spots: DeviceSpot[]) {
  const floors: { label: string; rooms: { room: string; spots: DeviceSpot[] }[] }[] = [];
  for (const s of [...spots].sort(compareSpots)) {
    const label = floorLabel(s);
    let f = floors[floors.length - 1];
    if (f?.label !== label) floors.push((f = { label, rooms: [] }));
    let r = f.rooms[f.rooms.length - 1];
    if (r?.room !== s.room) f.rooms.push((r = { room: s.room, spots: [] }));
    r.spots.push(s);
  }
  return floors;
}
