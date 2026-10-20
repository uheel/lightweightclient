import { api, session } from "@radar/core";
import { getRoomDevices } from "../api/device";

/**
 * 按床位整理房间里设备的长者关联：
 * - 绑在床位上的设备只关联这张床上的人，床空着就谁都不关联
 * - 只绑房间的设备（卫生间、客厅这类公共区域）：房间只住一个人时关联他；住两人以上谁都不关联，因为分不出是谁
 * 平台入住只在部分情况下这样关联，调床、对调只在新旧两张床都绑了设备时才跟着改，退住会留下调床剩下的旧关联
 * （2026-10-21 实测，见 docs/site-analysis.md"入住、调床、退住"），所以这些操作之后客户端把涉及的房间整理一遍。
 * 只动房间里的设备，戒指、手表这类不装在房间里的设备不碰。
 * 关联只能一位一位地加（/api/device/bind 会替换掉原来的人），规则里每台设备最多关联一位，正好够用。
 */

type Owner = { memberId: string; realName: string };

export interface SyncScope {
  /** 涉及的床位（改之前和改之后的都要给） */
  bedIds?: (string | undefined)[];
  roomIds?: (string | undefined)[];
  /** 这几位长者现在关联的房间设备所在的房间也整理（清掉调床留下的旧关联） */
  memberIds?: string[];
}

async function roomOfBed(bedId: string) {
  return (await api.get<{ roomId?: string }>("/api/bed", { params: { id: bedId } })).data?.roomId;
}

/** 本机构设备所在的房间；别的机构的设备取不到记录，返回 undefined */
async function roomOfDevice(deviceId: string) {
  const d = (await api.get<{ orgId?: string; properties?: { roomId?: string | null } }>("/api/device/v3", { params: { id: deviceId, propertyNames: "roomId" } })).data;
  return d?.orgId === session.get()?.orgId ? (d?.properties?.roomId ?? undefined) : undefined;
}

async function syncRoom(roomId: string): Promise<string[]> {
  const [beds, devices] = await Promise.all([
    api.get<{ id: string; buildingId: string; floorId: string }[]>("/api/bed/pages", { params: { current: 1, pageSize: 500 }, filter: { roomId } }).then((r) => r.data ?? []),
    getRoomDevices(roomId),
  ]);
  if (!devices.length) return [];
  // 床上住的是谁：床位列表只有名字，长者 id 要从 options-with-floor 取（必须带楼栋和楼层，一个房间的床都在同一层）
  const occupant = new Map<string, Owner>();
  if (beds.length) {
    const { buildingId, floorId } = beds[0];
    const list = (await api.get<{ bedId: string; memberId?: string; realName?: string }[]>("/api/bed/options-with-floor", { params: { buildingId, floorId } })).data ?? [];
    const mine = new Set(beds.map((b) => b.id));
    for (const x of list) if (x.memberId && mine.has(x.bedId)) occupant.set(x.bedId, { memberId: x.memberId, realName: x.realName ?? "?" });
  }
  const residents = [...occupant.values()];
  const owners = (await api.get<Record<string, Owner[]>>("/api/device-position/v2/batch-device-members", { params: { deviceIds: devices.map((d) => d.deviceId).join(",") } })).data ?? {};

  const changes: string[] = [];
  await Promise.all(
    devices.map(async (d) => {
      const want = d.bedId ? occupant.get(d.bedId) : residents.length === 1 ? residents[0] : undefined;
      const cur = owners[d.deviceId] ?? [];
      const drop = cur.filter((o) => o.memberId !== want?.memberId);
      const add = want && !cur.some((o) => o.memberId === want.memberId) ? want : undefined;
      for (const o of drop) await api.post("/api/device/unbind", { deviceId: d.deviceId, memberId: o.memberId });
      if (add) await api.post("/api/device/bind", { deviceId: d.deviceId, memberId: add.memberId });
      const parts = [add && `关联 ${add.realName}`, drop.length && `不再关联 ${drop.map((o) => o.realName).join("、")}`].filter(Boolean);
      if (parts.length) changes.push(`${d.deviceName || d.sn} ${parts.join("，")}`);
    }),
  );
  return changes;
}

/** 整理涉及到的房间，返回改了什么（给提示用） */
export async function syncDeviceMembers(scope: SyncScope): Promise<string[]> {
  const rooms = new Set(scope.roomIds?.filter((x): x is string => !!x));
  await Promise.all([
    ...(scope.bedIds ?? []).filter((x): x is string => !!x).map(async (id) => {
      const r = await roomOfBed(id);
      if (r) rooms.add(r);
    }),
    ...(scope.memberIds ?? []).map(async (memberId) => {
      const devs = (await api.get<{ deviceId: string }[]>("/api/member/devices", { params: { memberId } })).data ?? [];
      for (const r of await Promise.all(devs.map((d) => roomOfDevice(d.deviceId)))) if (r) rooms.add(r);
    }),
  ]);
  return (await Promise.all([...rooms].map(syncRoom))).flat();
}

/** 设备挪出房间：不再是房间设备，原来的关联去掉 */
export async function clearDeviceMembers(deviceId: string) {
  const cur = (await api.get<Owner[]>("/api/device-position/v2/device-members", { params: { deviceId } })).data ?? [];
  for (const o of cur) await api.post("/api/device/unbind", { deviceId, memberId: o.memberId });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 写操作成功之后调用：整理失败只提示，不算操作失败 */
export async function syncAfter(notify: { info: (s: string) => unknown; warning: (s: string) => unknown }, scope: SyncScope) {
  try {
    const changes = await syncDeviceMembers(scope);
    if (changes.length) notify.info(`已按床位更新设备关联：${changes.slice(0, 5).join("；")}${changes.length > 5 ? ` 等 ${changes.length} 台` : ""}`);
  } catch (e) {
    notify.warning(`设备关联没整理完：${errText(e)}。可以到长者页看一下关联的设备`);
  }
}
