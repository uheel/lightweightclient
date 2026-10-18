import { getRoomDevices, setRadarLocation, unbindBedDevice, type Radar, type RoomDevice } from "../api/device";
import { getRoomDesign } from "../api/room";
import { clearSlot, findRadar, placeInLayout, slotSource, type SlotSource } from "./radarSlot";

/**
 * 改雷达的安装位置。平台上"在哪个房间"有好几份记录（docs/room-device-model.md）：
 * 改绑定（device.roomId）不会动房间布置和床位，所以这里一起处理，避免留下旧布置、旧床位：
 * - 原房间：床位上绑着这台设备就解绑；布置里的雷达清掉设备、留下空位置（区域描述的是房间，下次装新设备直接用），也可以选连位置一起删
 * - 新房间：按"空位置 → 户型里的雷达 → 空白默认"把这台放进布置，见 rooms/radarSlot.ts
 */

export interface MovePlan {
  oldRoomId?: string;
  newRoomId?: string;
  /** 原房间里这台设备绑的床位 */
  bed?: RoomDevice;
  /** 原房间布置里有这台雷达 */
  oldSlot: boolean;
  /** 新房间布置里放哪 */
  newSlot?: SlotSource;
}

export async function planMove(d: Radar, newRoomId?: string): Promise<MovePlan> {
  const oldRoomId = d.roomId || undefined;
  const same = oldRoomId === newRoomId;
  const [oldDevices, oldDesign, newSlot] = await Promise.all([
    oldRoomId && !same ? getRoomDevices(oldRoomId).catch(() => []) : [],
    oldRoomId && !same ? getRoomDesign(oldRoomId).catch(() => undefined) : undefined,
    newRoomId && !same ? slotSource(d, newRoomId).catch(() => undefined) : undefined,
  ]);
  return {
    oldRoomId,
    newRoomId,
    bed: oldDevices.find((x) => x.sn === d.sn && x.bedId),
    oldSlot: !!findRadar(oldDesign?.elements, (e) => e.sn === d.sn),
    newSlot,
  };
}

/** 按 plan 执行；返回没做成的步骤（绑定改成功之后的步骤失败不回滚，提示用户去诊断页处理） */
export async function moveRadar(
  d: Radar,
  loc: { buildingId?: string; floorId?: string; roomId?: string } | null,
  plan: MovePlan,
  opts: { unbindBed: boolean; keepOldSlot: boolean; placeNew: boolean },
): Promise<string[]> {
  // 床位在原房间，先解绑，免得设备挪走了床位还指着它
  if (opts.unbindBed && plan.bed?.bedId) await unbindBedDevice(plan.bed.bedId);
  await setRadarLocation(d.id, loc);

  const failed: string[] = [];
  const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
  if (plan.oldSlot && plan.oldRoomId) {
    try {
      await clearSlot(d.sn, plan.oldRoomId, opts.keepOldSlot);
    } catch (e) {
      failed.push(`原房间布置没改成：${err(e)}`);
    }
  }
  if (opts.placeNew && plan.newSlot && plan.newRoomId) {
    try {
      await placeInLayout(d, plan.newRoomId, plan.newSlot);
    } catch (e) {
      failed.push(`放进新房间布置失败：${err(e)}`);
    }
  }
  return failed;
}
