import { api } from "@radar/core";
import type { PlanElement } from "../api/room";

/**
 * 雷达安装区域（字典 RADAR_INSTALL_AREA）：一个房间里装了几台雷达时（卧室一台、卫生间一台，型号也可能不同），靠它分清哪台装在哪。
 * 平台 v3 房间设计存在雷达元素的 rangeType（编号）/ rangeName（别名，没填别名时是区域名）；户型设计存在 qingLanConfig.extra.installArea / installAreaAlias。
 * "进入卫生间"这类场景按它判断，平台实时监护页长者设备的 rangeName 也是它。
 */

export interface InstallAreaOption {
  value: number;
  label: string;
}

/** 字典取不到时用这份（2026-10-20 平台字典；8 室外只给门的出区域用，雷达不能选） */
export const INSTALL_AREAS: InstallAreaOption[] = [
  { value: 1, label: "卧室" },
  { value: 2, label: "客厅" },
  { value: 3, label: "厨房" },
  { value: 7, label: "卫生间" },
  { value: 9, label: "其他" },
];

export const INSTALL_AREA: Record<number, string> = Object.fromEntries(INSTALL_AREAS.map((a) => [a.value, a.label]));
export const BEDROOM = 1;
export const BATHROOM = 7;

let cache: Promise<InstallAreaOption[]> | undefined;

/** 平台字典（取一次，之后复用）；"不能在雷达安装区域中使用"的项去掉 */
export function getInstallAreas() {
  cache ??= api
    .get<{ label: string; value: string; description?: string }[]>("/sapi/code/options", { params: { codeType: "RADAR_INSTALL_AREA" } })
    .then((r) => {
      const list = (r.data ?? [])
        .filter((x) => !x.description?.includes("不能在雷达安装区域"))
        .map((x) => ({ value: Number(x.value), label: x.label }))
        .filter((x) => Number.isInteger(x.value));
      for (const x of list) INSTALL_AREA[x.value] = x.label;
      return list.length ? list : INSTALL_AREAS;
    })
    .catch(() => {
      cache = undefined;
      return INSTALL_AREAS;
    });
  return cache;
}

export interface InstallArea {
  type?: number;
  /** 别名（例如"主卧""客卫"），没填时和区域名一样 */
  name?: string;
}

/** 布置里这台雷达的安装区域：先看元素上的 rangeType / rangeName，没有再看户型拷过来的 qingLanConfig.extra */
export function installAreaOf(e?: PlanElement): InstallArea | undefined {
  if (!e) return undefined;
  const t = Number(e.rangeType);
  if (e.rangeType !== undefined && e.rangeType !== null && Number.isInteger(t)) return { type: t, name: e.rangeName || INSTALL_AREA[t] };
  const x = e.qingLanConfig?.extra;
  const xt = Number(x?.installArea);
  if (x?.installArea !== undefined && x.installArea !== null && x.installArea !== "" && Number.isInteger(xt))
    return { type: xt, name: x.installAreaAlias || INSTALL_AREA[xt] };
  return undefined;
}

/** 显示用：别名和区域名不一样时写成"主卧（卧室）" */
export function areaText(a?: InstallArea) {
  if (!a?.type && !a?.name) return undefined;
  const base = a.type !== undefined ? INSTALL_AREA[a.type] : undefined;
  if (!base) return a.name;
  return a.name && a.name !== base ? `${a.name}（${base}）` : base;
}

/** 把安装区域写到雷达元素上（和平台 v3 房间设计一样写 rangeType / rangeName）；null 清掉 */
export function withArea(e: PlanElement, area: InstallArea | null): PlanElement {
  const { rangeType: _t, rangeName: _n, ...rest } = e;
  if (!area?.type) return { ...rest, rangeType: null, rangeName: null };
  return { ...rest, rangeType: area.type, rangeName: area.name?.trim() || INSTALL_AREA[area.type] || null };
}
