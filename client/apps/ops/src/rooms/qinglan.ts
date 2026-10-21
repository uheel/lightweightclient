/**
 * 雷达区域配置（平台的 qingLanConfig）：容器尺寸、换算成设备数组、校验。全部在本地算，不调平台的 qinglan-compute / qinglan-validate。
 * 规则和实测见 docs/site-analysis.md"房间户型与雷达区域下发"。
 *
 * 坐标：房间平面图 1px = 1cm。container / bound 在房间坐标里；radar / supervision / ranges 在容器坐标里（相对 container.x/y）。
 */

export interface QlRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QlZone {
  id?: string;
  /** 平台画布上显示的编号。设备和场景用的是在 ranges 里的位置（见 zonesOf），保存布置时客户端把它重写成位置 */
  index?: number;
  /** 2 普通床，3 干扰区，4 门，5 监护床，6 感应区，7 家具 */
  type: number;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  /** 空间区域类型（字典 ROOM_SPACE_TYPE），56 马桶、57 淋浴等 */
  spaceType?: number;
}

export interface QlConfig {
  /** 3 人员跟踪，7 跌倒监测，11 呼吸睡眠，15 床位监护 */
  workingType?: number;
  /** 0 顶装，1 侧装 */
  installType?: number;
  /** 1 上，2 右，3 下，4 左 */
  installDirection?: number;
  /** 米（其他坐标都是厘米） */
  installHeight?: number;
  container?: QlRect;
  radar?: { x: number; y: number; width?: number; height?: number };
  bound?: QlRect;
  supervision?: { x: number; y: number };
  ranges?: QlZone[];
  extra?: { installArea?: string | number | null; installAreaAlias?: string | null };
  fallTime?: number;
}

export const ZONE_TYPE: Record<number, string> = { 2: "普通床", 3: "干扰区", 4: "门", 5: "监护床", 6: "感应区", 7: "家具" };
export const ZONE_COLOR: Record<number, string> = { 2: "#5B9BD5", 3: "#ED7D31", 4: "#3F9B3A", 5: "#E5484D", 6: "#9254DE", 7: "#8C8C8C" };
export const MODE: Record<number, string> = { 3: "人员跟踪", 7: "跌倒监测", 11: "呼吸睡眠", 15: "床位监护" };
export const MOUNT: Record<number, string> = { 0: "顶装", 1: "侧装" };
export const FACING: Record<number, string> = { 1: "朝上", 2: "朝右", 3: "朝下", 4: "朝左" };
/** 侧装的方向是"装在哪面墙"：朝上 = 装在平面图上边的墙、往下看 */
const SIDE_WALL: Record<number, string> = { 1: "装在上墙、往下看", 2: "装在右墙、往左看", 3: "装在下墙、往上看", 4: "装在左墙、往右看" };
export const facingText = (c: QlConfig) => (c.installType === 1 ? SIDE_WALL : FACING)[facingOf(c)]!;

const TOP = 0;
const SIDE = 1;
const SLEEP = 11;
const TRACKING = 3;
const BED_CARE = 15;

export const mountOf = (c: QlConfig) => (c.installType === SIDE ? SIDE : TOP);
export const facingOf = (c: QlConfig) => (c.installDirection && c.installDirection >= 1 && c.installDirection <= 4 ? c.installDirection : 1);
export const modeOf = (c: QlConfig) => c.workingType ?? BED_CARE;
/** 雷达朝上 / 朝下时容器横放 */
const upDown = (c: QlConfig) => facingOf(c) === 1 || facingOf(c) === 3;

/** 容器（最大探测范围）尺寸：由安装方式、朝向、工作模式决定，平台编辑器里不能拖 */
export function containerSize(c: QlConfig) {
  const ud = upDown(c);
  if (mountOf(c) === SIDE) {
    if (modeOf(c) === TRACKING) return ud ? { width: 800, height: 600 } : { width: 600, height: 800 };
    if (modeOf(c) === SLEEP) return ud ? { width: 120, height: 200 } : { width: 200, height: 120 };
  }
  return ud ? { width: 600, height: 400 } : { width: 400, height: 600 };
}

/** 雷达在容器里的位置：顶装在正中，侧装在朝向那一边的中点。平台换算时也按这个规则自己算，不用存的 radar.x/y */
export function radarInContainer(c: QlConfig) {
  const { width: w, height: h } = containerSize(c);
  if (mountOf(c) === TOP) return { x: w / 2, y: h / 2 };
  const f = facingOf(c);
  return f === 1 ? { x: w / 2, y: 0 } : f === 2 ? { x: w, y: h / 2 } : f === 3 ? { x: w / 2, y: h } : { x: 0, y: h / 2 };
}

/** 监护区边长：顶装 300 cm，侧装 200 cm */
export const supervisionSize = (c: QlConfig) => (mountOf(c) === TOP ? 300 : 200);

/** 容器在房间里的位置（尺寸按规则） */
export function containerRect(c: QlConfig): QlRect {
  return { x: c.container?.x ?? 0, y: c.container?.y ?? 0, ...containerSize(c) };
}

/** 监测边界（房间坐标）；没有时就是整个容器 */
export const boundRect = (c: QlConfig): QlRect => c.bound ?? containerRect(c);

/** 区域在房间里的位置 */
export function zoneRect(c: QlConfig, z: QlZone): QlRect {
  const o = containerRect(c);
  return { x: o.x + z.x, y: o.y + z.y, width: z.width, height: z.height };
}

/** 雷达在房间里的位置 */
export function radarInRoom(c: QlConfig) {
  const o = containerRect(c);
  const r = radarInContainer(c);
  return { x: o.x + r.x, y: o.y + r.y };
}

/** 监护区（房间坐标） */
export function supervisionRect(c: QlConfig): QlRect {
  const o = containerRect(c);
  const s = supervisionSize(c);
  return { x: o.x + (c.supervision?.x ?? 0), y: o.y + (c.supervision?.y ?? 0), width: s, height: s };
}

/**
 * 区域列表，index = 在 ranges 里的位置。平台下发（qinglan-compute）按位置编号，不用存的 index，
 * 所以设备、场景用的区域号就是位置；存的 index 删区域后会留空号，只是平台画布上显示的数。见 docs/room-device-model.md"区域编号有三个数"。
 */
export const zonesOf = (c: QlConfig): (QlZone & { index: number })[] => (c.ranges ?? []).map((z, i) => ({ ...z, index: i }));

/** 存的 index 和位置对不上的区域（平台画布显示的编号和设备上的不一样） */
export const zoneIndexDrift = (c: QlConfig) =>
  (c.ranges ?? []).flatMap((z, i) => (z.index !== undefined && z.index !== i ? [{ stored: z.index, actual: i, zone: z }] : []));

/** 把存的 index 改成位置（设备数组不变，不用下发）；没有要改的就原样返回 */
export function renumberZones(c: QlConfig): QlConfig {
  if (!c.ranges?.some((z, i) => z.index !== i)) return c;
  return { ...c, ranges: c.ranges.map((z, i) => ({ ...z, index: i })) };
}

// ---------- 换算成设备数组 ----------

/** 容器坐标里相对雷达的偏移 (dx, dy) → 雷达坐标 (x, y)，是平台 toRoom 的逆运算 */
function toRadar(c: QlConfig, dx: number, dy: number): [number, number] {
  const f = facingOf(c);
  if (mountOf(c) === TOP) return f === 1 ? [dx, -dy] : f === 3 ? [-dx, dy] : f === 2 ? [dy, dx] : [-dy, -dx];
  return f === 1 ? [-dx, dy] : f === 3 ? [dx, -dy] : f === 2 ? [-dy, -dx] : [dy, dx];
}

/** toRadar 的逆运算：雷达坐标 (x, y) → 相对雷达的容器坐标偏移 (dx, dy) */
function fromRadar(c: QlConfig, x: number, y: number): [number, number] {
  const f = facingOf(c);
  if (mountOf(c) === TOP) return f === 1 ? [x, -y] : f === 3 ? [-x, y] : f === 2 ? [y, x] : [-y, -x];
  return f === 1 ? [-x, y] : f === 3 ? [x, -y] : f === 2 ? [-y, -x] : [y, x];
}

/** 设备数组里的 8 个角（分米）→ 容器坐标里的矩形（cm），r 是雷达在容器里的位置 */
export function rectFromCorners(c: QlConfig, corners8: number[], r: { x: number; y: number }): QlRect {
  const xs = [corners8[0], corners8[2], corners8[4], corners8[6]].map((v) => (v ?? 0) * 10);
  const ys = [corners8[1], corners8[3], corners8[5], corners8[7]].map((v) => (v ?? 0) * 10);
  const [ax, ay] = fromRadar(c, Math.min(...xs), Math.min(...ys));
  const [bx, by] = fromRadar(c, Math.max(...xs), Math.max(...ys));
  return { x: r.x + Math.min(ax, bx), y: r.y + Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/** 容器坐标里的矩形 → 雷达坐标的 [xMin, xMax, yMin, yMax]（cm），r 是雷达在容器里的位置 */
function radarBox(c: QlConfig, r: { x: number; y: number }, x0: number, y0: number, x1: number, y1: number) {
  const [ax, ay] = toRadar(c, x0 - r.x, y0 - r.y);
  const [bx, by] = toRadar(c, x1 - r.x, y1 - r.y);
  return [Math.min(ax, bx), Math.max(ax, bx), Math.min(ay, by), Math.max(ay, by)] as const;
}

/** .NET Math.Round 的默认舍入：.5 取偶 */
function roundHalfEven(v: number) {
  const f = Math.floor(v);
  const d = v - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(v);
}

/** 4 个角按 X-Y-, X+Y-, X-Y+, X+Y+ 排列（分米），-0 改成 0 */
const corners = (b: readonly [number, number, number, number], f: (v: number) => number) =>
  [b[0], b[2], b[1], b[2], b[0], b[3], b[1], b[3]].map((v) => f(v / 10) + 0);

export interface DeviceArrays {
  /** QL_radar_config：[安装方式, 高度(分米), 8 个角, 工作模式] */
  config: number[];
  /** QL_radar_area：[[区域 ID, 区域类型, 8 个角], …] */
  area: number[][];
}

/**
 * 和平台 POST /api/device-config/qinglan-compute 的结果逐位一致（2026-10-17 用李虎、藕塘全部 56 份布置和平台逐台核对）：
 * - 区域：坐标先截成整厘米，雷达位置按装法规则算（不看存的 radar.x/y），换成分米后向零截断
 * - 监测边界：雷达位置用存的 radar.x/y（没有时按规则），换成分米后 .5 取偶舍入；侧装时近端 y 固定为 0
 * 两个雷达位置只在旧的、尺寸和装法对不上的数据里会不一样，validate 会提示。
 */
export function toDeviceArrays(c: QlConfig): DeviceArrays {
  const o = containerRect(c);
  const b = boundRect(c);
  const rule = radarInContainer(c);
  const stored = c.radar ? { x: c.radar.x, y: c.radar.y } : rule;
  const bb = [...radarBox(c, stored, b.x - o.x, b.y - o.y, b.x - o.x + b.width, b.y - o.y + b.height)] as [number, number, number, number];
  if (mountOf(c) === SIDE) bb[2] = 0;
  const t = Math.trunc;
  return {
    config: [mountOf(c), Math.round((c.installHeight ?? 0) * 10), ...corners(bb, roundHalfEven), modeOf(c)],
    area: zonesOf(c).map((z) => [z.index, z.type, ...corners(radarBox(c, rule, t(z.x), t(z.y), t(z.x) + t(z.width), t(z.y) + t(z.height)), t)]),
  };
}

/** 平台记录 / 设备读回的数组可能是 JSON 字符串 */
export function parseArray(v: unknown): unknown[] | undefined {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export const sameArray = (a: unknown, b: unknown) => JSON.stringify(parseArray(a) ?? a) === JSON.stringify(parseArray(b) ?? b);

const nums = (v: unknown) => (parseArray(v) ?? []).map((x) => Number(x));
/** 8 个角（分米）→ 宽 × 深 */
function sizeOf(c: number[]) {
  const xs = [c[0], c[2], c[4], c[6]].map((v) => v ?? 0);
  const ys = [c[1], c[3], c[5], c[7]].map((v) => v ?? 0);
  return `${(Math.max(...xs) - Math.min(...xs)) / 10} × ${(Math.max(...ys) - Math.min(...ys)) / 10} 米`;
}
/** 两个范围的差别，只说大小，不出现坐标 */
const rangeChange = (want: number[], got: number[]) => (sizeOf(want) === sizeOf(got) ? `大小一样（${sizeOf(want)}），位置不同` : `布置是 ${sizeOf(want)}，设备上是 ${sizeOf(got)}`);

/** 布置算出来的数组（want）和设备上 / 平台记录里的数组（got）逐项比，返回看得懂的差异 */
export function describeDiff(want: DeviceArrays, gotConfig: unknown, gotArea: unknown): string[] {
  const w = want;
  const out: string[] = [];
  const gc = nums(gotConfig);
  if (gc.length >= 11) {
    if (gc[0] !== w.config[0]) out.push(`装法：布置是${MOUNT[w.config[0]!] ?? w.config[0]}，设备上是${MOUNT[gc[0]!] ?? gc[0]}`);
    if (gc[1] !== w.config[1]) out.push(`高度：布置是 ${(w.config[1] ?? 0) / 10} 米，设备上是 ${(gc[1] ?? 0) / 10} 米`);
    if (gc[10] !== w.config[10]) out.push(`模式：布置是${MODE[w.config[10]!] ?? w.config[10]}，设备上是${MODE[gc[10]!] ?? gc[10]}`);
    const wr = w.config.slice(2, 10);
    const gr = gc.slice(2, 10);
    if (JSON.stringify(wr) !== JSON.stringify(gr)) out.push(`监测范围：${rangeChange(wr, gr)}`);
  } else if (gotConfig !== undefined) out.push("安装配置的格式不对");
  const rows = (parseArray(gotArea) ?? []).map(nums).filter((r) => r.length >= 10);
  const name = (r: number[]) => `区域 ${r[0]}（${ZONE_TYPE[r[1]!] ?? `类型 ${r[1]}`}）`;
  for (const a of w.area) {
    const g = rows.find((r) => r[0] === a[0]);
    if (!g) out.push(`${name(a)}：设备上没有`);
    else if (g[1] !== a[1]) out.push(`区域 ${a[0]}：布置是${ZONE_TYPE[a[1]!] ?? a[1]}，设备上是${ZONE_TYPE[g[1]!] ?? g[1]}`);
    else if (JSON.stringify(g.slice(2, 10)) !== JSON.stringify(a.slice(2, 10))) out.push(`${name(a)}：${rangeChange(a.slice(2, 10), g.slice(2, 10))}`);
  }
  for (const g of rows) if (!w.area.some((a) => a[0] === g[0])) out.push(`设备上多了${name(g)}，布置里没有`);
  return out;
}

// ---------- 校验 ----------

/**
 * 问题在设备详情的哪里改（快速开始跳过去时打开对应的页签、滚到那一项并闪一下）：
 * room 概览的房间，area 概览的安装区域，angle 概览的安装角度，heartbeat 概览的最近心跳，
 * mount 属性里的安装与监测范围，zones 属性里的区域划分，layout 属性里的"按房间布置下发"，alarm 告警配置
 */
export type Spot = "room" | "area" | "angle" | "heartbeat" | "mount" | "zones" | "layout" | "alarm";

export interface Issue {
  /** error：平台不接受或设备上不对；warn：能用但要注意 */
  level: "error" | "warn";
  text: string;
  /** 在设备详情哪里改；没写的按区域问题算（zones） */
  spot?: Spot;
  /** 涉及的区域 ID */
  zone?: number;
  /** 逐项说明（例如布置和设备哪几个区域不一样） */
  details?: string[];
  /** 诊断页能一键修的：renumber 重排区域编号并保存布置；add-slot 把绑在房间的雷达放进布置 */
  fix?: "renumber" | "add-slot";
}

const zoneName = (z: QlZone & { index: number }) => `区域 ${z.index}（${z.text || ZONE_TYPE[z.type] || `类型 ${z.type}`}）`;

function overlaps(a: QlRect, b: QlRect) {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0;
}
const inside = (a: QlRect, b: QlRect) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

/**
 * 平台网页端和后端校验规则的并集（后端还查重叠、前端还查边界），外加平台不查但设备会出问题的几条。
 */
export function validate(c: QlConfig): Issue[] {
  const out: Issue[] = [];
  const zones = zonesOf(c);
  const size = containerSize(c);
  const mode = modeOf(c);

  const rule = radarInContainer(c);
  if (c.radar && (c.radar.x !== rule.x || c.radar.y !== rule.y))
    out.push({ level: "warn", text: "雷达位置和装法对不上（旧数据），平台换算区域和边界时用的雷达位置不同，设备上的区域可能偏了，建议重新保存布置", spot: "mount" });
  if (c.container && (c.container.width !== size.width || c.container.height !== size.height))
    out.push({ level: "warn", text: `探测范围尺寸是 ${c.container.width}×${c.container.height}，按当前装法应为 ${size.width}×${size.height}`, spot: "mount" });
  const h = c.installHeight;
  if (h === undefined || h <= 0) out.push({ level: "error", text: "没有安装高度", spot: "mount" });
  else if (mountOf(c) === SIDE && (h < 1.5 || h > 3.5)) out.push({ level: "warn", text: `侧装高度 ${h} m，平台只允许 1.5～3.5 m（低于 1.5 m 时床上坐起的识别率会大大降低）`, spot: "mount" });

  if (zones.length > 16) out.push({ level: "error", text: `区域有 ${zones.length} 个，设备最多 16 个` });
  const drift = zoneIndexDrift(c);
  if (drift.length)
    out.push({
      level: "warn",
      text: `平台画布上的区域编号和设备上的不一样（删过中间的区域留了空号）：${drift.map((d) => `画布 ${d.stored} = 设备 ${d.actual}（${d.zone.text || ZONE_TYPE[d.zone.type] || `类型 ${d.zone.type}`}）`).join("，")}。场景要按设备编号填；重排编号后两边一致，设备上不变`,
      zone: drift[0]!.actual,
      fix: "renumber",
    });

  const bound = boundRect(c);
  for (const z of zones) {
    if (z.type === 3) continue;
    if (!inside(zoneRect(c, z), bound)) out.push({ level: "error", text: `${zoneName(z)}超出了监测边界`, zone: z.index });
  }

  const beds = zones.filter((z) => z.type === 5);
  if (beds.length > 1) out.push({ level: "error", text: `监护床有 ${beds.length} 个，最多 1 个` });
  const sup = supervisionRect(c);
  if (beds.length === 1 && !inside(zoneRect(c, beds[0]!), sup))
    out.push({ level: "error", text: `监护床不在监护区里（${supervisionSize(c)} cm 见方），离雷达太远或位置不对`, zone: beds[0]!.index });
  if (mode === BED_CARE) {
    for (const z of zones) if (z.type === 2 && overlaps(zoneRect(c, z), sup)) out.push({ level: "error", text: `${zoneName(z)}（普通床）压到了监护区`, zone: z.index });
    if (!beds.length) out.push({ level: "warn", text: "工作模式是床位监护，但区域里还没画监护床，离床、坐起等告警用不了" });
  }
  if (mode !== SLEEP && !zones.some((z) => z.type === 4)) out.push({ level: "error", text: "至少要有一个门" });

  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i]!;
      const b = zones[j]!;
      if (a.type === 3 || b.type === 3) continue;
      if (overlaps(zoneRect(c, a), zoneRect(c, b))) out.push({ level: "error", text: `${zoneName(a)}和${zoneName(b)}重叠`, zone: a.index });
    }

  return out;
}
