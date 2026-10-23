import { api } from "@radar/core";

/**
 * 房间视图详情（/api/room-view/v3/detail），外框尺寸换成布置里的。
 * 视图里的 background 是另存的一份，改房间尺寸（/api/room/v3/size）后不跟着变：
 * 2026-10-23 芦坪社区孝老食堂 / 卫生间过道，布置 roomStyle 已是 290×400，视图 background 还是 100×100，设备属性里的区域画布和轨迹回放都按 1×1 米画。
 * 所以同时取布置（/api/room/v3/design），以布置的 roomStyle 为准，没有时用房间长宽
 */
export async function getRoomView<T extends { background?: { width?: number; height?: number } }>(roomId: string) {
  const [view, design] = await Promise.all([
    api.get<T>("/api/room-view/v3/detail", { params: { roomId } }),
    api
      .get<{ roomStyle?: { width?: number; height?: number }; roomWidth?: number; roomLong?: number }>("/api/room/v3/design", { params: { roomId } })
      .then((r) => r.data, () => undefined),
  ]);
  const d = view.data;
  if (!d || !design) return d;
  const width = design.roomStyle?.width || (design.roomWidth ? Math.round(design.roomWidth * 100) : 0);
  const height = design.roomStyle?.height || (design.roomLong ? Math.round(design.roomLong * 100) : 0);
  return width && height ? { ...d, background: { ...d.background, width, height } } : d;
}
