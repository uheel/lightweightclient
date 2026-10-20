import { api } from "@radar/core";
import { deleteRadar, getRoomDevices, type Radar, type RoomDevice } from "../api/device";
import { getRoomDesign } from "../api/room";
import { clearSlot, findRadar } from "../rooms/radarSlot";

/**
 * 删除雷达。平台删除会一起清掉房间绑定、床位绑定和长者关联，但不动房间布置（2026-10-20 实测，见 docs/site-analysis.md"删除设备"），
 * 所以这里删完再把布置里的雷达位置处理掉：默认留下空位置（安装方式和区域描述的是房间，下次装新设备直接用），也可以连位置一起删
 */

export interface DeletePlan {
  roomId?: string;
  /** 这台设备绑的床位 */
  bed?: RoomDevice;
  /** 房间布置里有这台雷达 */
  slot: boolean;
  /** 关联的长者（办入住会自动关联房间里的设备，可能不止一位） */
  members: string[];
}

export async function planDelete(d: Radar): Promise<DeletePlan> {
  const roomId = d.roomId || undefined;
  const [devices, design, members] = await Promise.all([
    roomId ? getRoomDevices(roomId).catch(() => []) : [],
    roomId ? getRoomDesign(roomId).catch(() => undefined) : undefined,
    api
      .get<{ realName?: string }[]>("/api/device-position/v2/device-members", { params: { deviceId: d.id } })
      .then((r) => (r.data ?? []).map((m) => m.realName ?? "?"))
      .catch(() => (d.realName ? [d.realName] : [])),
  ]);
  return {
    roomId,
    bed: devices.find((x) => x.sn === d.sn && x.bedId),
    slot: !!findRadar(design?.elements, (e) => e.sn === d.sn),
    members,
  };
}

/** 按 plan 执行；设备删掉之后布置没改成不回滚，返回没做成的步骤，提示用户去诊断页处理 */
export async function removeRadar(d: Radar, plan: DeletePlan, opts: { keepSlot: boolean }): Promise<string[]> {
  await deleteRadar(d.id);
  const failed: string[] = [];
  if (plan.slot && plan.roomId) {
    try {
      await clearSlot(d.sn, plan.roomId, opts.keepSlot);
    } catch (e) {
      failed.push(`房间布置没改成：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return failed;
}
