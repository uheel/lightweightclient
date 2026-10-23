import { writeDeviceProperties } from "../api/device";
import { getRoomDesign, saveRoomDesign, type PlanElement } from "../api/room";
import {
  containerRect,
  containerSize,
  mountOf,
  parseArray,
  radarInContainer,
  radarInRoom,
  rectFromCorners,
  sameArray,
  supervisionSize,
  toDeviceArrays,
  ZONE_COLOR,
  ZONE_TYPE,
  zonesOf,
  type QlConfig,
  type QlZone,
} from "./qinglan";

/**
 * 在设备属性里直接下发了安装配置 / 区域之后，把同样的改动写回房间布置。
 * 平台的房间详情、运维端"诊断"页都以房间布置为准；不写回的话，设备是新的、平台上画的还是旧的。
 * 平台 v3 房间设计里的"读取区域"也是这样把设备上的区域套回画布。
 */

export interface SyncResult {
  /** 写回了布置 */
  changed: boolean;
  /** 没写回的原因，或需要人看一眼的提示 */
  note?: string;
}

const nums = (v: unknown) => (parseArray(v) ?? []).map(Number);

/** 十六进制颜色 → 平台区域用的半透明填充 */
const fillOf = (type: number) => {
  const hex = (ZONE_COLOR[type] ?? "#999999").replace("#", "");
  const n = parseInt(hex.length === 3 ? hex.replace(/./g, "$&$&") : hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.7)`;
};

/** 区域的名字和空间区域类型（设备不存），按区域编号 */
export type ZoneNames = Record<number, { text?: string; spaceType?: number }>;

/** 顶装 / 侧装互换时的新朝向，以及雷达在房间里的新位置（cm） */
export interface MountChange {
  facing: number;
  radar?: { x: number; y: number };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * 按设备上的数组更新一份区域配置；返回 config 为空表示不能自动写回（带原因）。
 * 改了安装方式时要带上 mount：探测范围换成新装法的，按雷达在房间里的新位置摆放，区域按新坐标系换回房间坐标。
 */
export function applyDeviceArrays(c: QlConfig, written: { config?: unknown; area?: unknown }, mount?: MountChange, names?: ZoneNames): { config?: QlConfig; note?: string } {
  const next: QlConfig = JSON.parse(JSON.stringify(c));
  const cur = toDeviceArrays(c);
  // 换回房间坐标用的那份配置：装法 / 朝向变了就用新的
  let geo = c;

  if (written.config !== undefined) {
    const g = nums(written.config);
    if (g.length < 11) return { note: "安装配置格式不对，没有写回房间布置" };
    // 在设备属性里切换过装法（哪怕又切回来）雷达位置都可能变了，按新位置重摆
    const remount = g[0] !== mountOf(c) || mount !== undefined;
    if (remount && !mount) return { note: "改了安装方式（顶装 / 侧装），但不知道雷达挪到了哪里，没有写回房间布置，请在房间布置里重新画" };
    // 没有区域的雷达挪位置时区域数组不变、不会下发，照样能写回
    if (remount && written.area === undefined && zonesOf(c).length) return { note: "改了安装方式或雷达位置，但这次没有下发区域，没有写回房间布置" };
    next.installHeight = g[1]! / 10;
    next.workingType = g[10];
    if (remount) {
      next.installType = g[0];
      next.installDirection = mount!.facing;
      // 容器尺寸按新装法查表，摆到雷达在房间里的新位置上
      const at = mount!.radar ?? radarInRoom(c);
      const size = containerSize(next);
      const rule = radarInContainer(next);
      next.container = { x: Math.round(at.x - rule.x), y: Math.round(at.y - rule.y), ...size };
      next.radar = { ...next.radar, x: rule.x, y: rule.y };
      geo = next;
    }
    // 监测范围：和布置算出来的一样就不动，否则按设备的范围换回来
    const corners = g.slice(2, 10);
    if (remount || !sameArray(corners, cur.config.slice(2, 10))) {
      const o = containerRect(geo);
      const r = remount ? radarInContainer(geo) : c.radar ? { x: c.radar.x, y: c.radar.y } : radarInContainer(c);
      const b = rectFromCorners(geo, corners, r);
      next.bound = { x: o.x + b.x, y: o.y + b.y, width: b.width, height: b.height };
    }
  }

  if (written.area !== undefined) {
    // 区域号 = 位置：设备的行按区域号排好，第 k 行对应布置里第 k 个区域（类型相同才算同一个，保留名称、spaceType、id）
    const rows = (parseArray(written.area) ?? [])
      .map(nums)
      .filter((r) => r.length >= 10)
      .sort((a, b) => a[0]! - b[0]!);
    const old = zonesOf(c);
    const r = radarInContainer(geo);
    next.ranges = rows.map((row, index): QlZone => {
      const type = row[1]!;
      const prev = old[index]?.type === type ? old[index] : undefined;
      const rect = rectFromCorners(geo, row.slice(2, 10), r);
      return {
        ...(prev ?? { id: `z${Date.now().toString(36)}${index}`, text: ZONE_TYPE[type] ?? `区域 ${index}`, fill: fillOf(type) }),
        index,
        type,
        ...rect,
      };
    });
  }
  if (names && next.ranges) {
    // 没填名字的保留原来的（类型改了时是类型名）；空间区域类型以编辑器为准，清掉就删掉
    next.ranges = next.ranges.map((z, i) => {
      const m = names[i];
      if (!m) return z;
      const { spaceType: _s, ...rest } = z;
      return { ...rest, text: m.text?.trim() || z.text, ...(m.spaceType !== undefined ? { spaceType: m.spaceType } : {}) };
    });
  }
  if (geo !== c) next.supervision = placeSupervision(next);
  return { config: next };
}

/** 监护区（正方形）摆到能包住监护床的位置，限制在容器里；没有监护床时按平台的默认位置 */
function placeSupervision(c: QlConfig) {
  const size = containerSize(c);
  const s = supervisionSize(c);
  const bed = zonesOf(c).find((z) => z.type === 5);
  if (bed) {
    return {
      x: Math.round(clamp(bed.x + bed.width / 2 - s / 2, 0, size.width - s)),
      y: Math.round(clamp(bed.y + bed.height / 2 - s / 2, 0, size.height - s)),
    };
  }
  if (mountOf(c) === 0) return { x: size.width / 2 - s / 2, y: size.height / 2 - s / 2 };
  const f = c.installDirection ?? 1;
  return f === 1 ? { x: size.width / 2 - s / 2, y: 0 } : f === 2 ? { x: size.width - s, y: size.height / 2 - s / 2 } : f === 3 ? { x: size.width / 2 - s / 2, y: size.height - s } : { x: 0, y: size.height / 2 - s / 2 };
}

/** 找到布置里这台雷达的元素（含组合里的），返回替换后的元素列表 */
function replaceRadar(list: PlanElement[] | undefined, sn: string, cfg: QlConfig, at?: { x: number; y: number }): [PlanElement[], boolean] {
  let hit = false;
  const out = (list ?? []).map((e) => {
    if (e.type === 3 && e.sn === sn) {
      hit = true;
      return { ...e, qingLanConfig: cfg, ...(at ? { x: Math.round(at.x), y: Math.round(at.y) } : {}) };
    }
    if (e.children?.length) {
      const [children, h] = replaceRadar(e.children, sn, cfg, at);
      if (h) hit = true;
      return h ? { ...e, children } : e;
    }
    return e;
  });
  return [out, hit];
}

/** names：区域名字和空间区域类型；只改了这些时 written 为空，只写布置、不碰设备 */
export async function syncLayoutFromDevice(roomId: string, sn: string, written: { config?: unknown; area?: unknown }, mount?: MountChange, names?: ZoneNames): Promise<SyncResult> {
  const design = await getRoomDesign(roomId);
  const find = (list?: PlanElement[]): PlanElement | undefined => {
    for (const e of list ?? []) {
      if (e.type === 3 && e.sn === sn) return e;
      const c = find(e.children);
      if (c) return c;
    }
  };
  const el = find(design?.elements);
  if (!design || !el?.qingLanConfig) return { changed: false, note: "这台雷达不在房间布置里，平台房间图上不会显示这些区域" };
  const { config, note } = applyDeviceArrays(el.qingLanConfig, written, mount, names);
  if (!config) return { changed: false, note };
  if (JSON.stringify(config) === JSON.stringify(el.qingLanConfig)) return { changed: false };
  const remounted = mount !== undefined || config.installType !== el.qingLanConfig.installType;
  const [elements] = replaceRadar(design.elements, sn, config, remounted ? radarInRoom(config) : undefined);
  await saveRoomDesign(roomId, { roomStyle: design.roomStyle, elements });
  // 平台网页端"读取区域"按这两个平台属性还原画布，一起更新（只保存，不下发）
  await writeDeviceProperties(sn, [
    { propertyName: "QL_radar_design", value: config },
    { propertyName: "QL_radar_working_type", value: config.workingType ?? 15 },
  ], true).catch(() => {});
  return { changed: true };
}
