import type { Radar } from "../api/device";
import { MASTER_TYPE, type Master } from "../api/master";

/** 设备列表里的类型：雷达和管理主机单列，其余按平台设备类型字典的分组 */
export type DevCat = "radar" | "master" | "slave" | "watch" | "ring" | "gait" | "other";

export const CATS: { key: DevCat; label: string }[] = [
  { key: "radar", label: "雷达" },
  { key: "master", label: "管理主机" },
  { key: "slave", label: "外设" },
  { key: "watch", label: "手表" },
  { key: "ring", label: "戒指" },
  { key: "gait", label: "步态" },
  { key: "other", label: "其他" },
];

export const catLabel = (c: DevCat) => CATS.find((x) => x.key === c)!.label;

/** 设备列表的一行：统一成雷达列表的字段，管理主机带上主机自己的记录 */
export type DevRow = Radar & { cat: DevCat; master?: Master };

export function catOf(deviceType: number, groups: Map<number, string>): DevCat {
  if (deviceType === MASTER_TYPE) return "master";
  switch (groups.get(deviceType)) {
    case "RADAR":
      return "radar";
    case "SLAVE":
      return "slave";
    case "WATCH":
      return "watch";
    case "RING":
      return "ring";
    case "GAIT":
      return "gait";
    default:
      return "other";
  }
}
