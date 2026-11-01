import { ALARM_POSTURES, api, LIVE_STALE_MS, type DeviceLink, type LiveData } from "@radar/core";
import type { OpsAlert } from "../api/device";
import { ALERT_FRESH_MS, bedName, bedVitals, CARE_GROUPS, deviceState, hasVitals, type RoomTile } from "../monitor/useMonitorData";

/**
 * 数据魔墙：全房间实时看板的模型（口径见 docs/data-wall.md 第 1 节）。
 * 房间、雷达、实时推送、告警都用监控模式的 useMonitorData；这里只把它们归成"每台雷达一个格子"，再排成一屏。
 */

/** 雷达的工作模式和长者（来自实时监护的长者列表；没绑长者的雷达不在里面） */
export interface Slot {
  mode?: number;
  /** 这台雷达只对应一位长者时才有 */
  realName?: string;
}

interface PanoramicMember {
  realName?: string;
  devices?: { sn: string; qlWorkingType?: number }[];
}

const modesKey = (orgId: string) => `ops.dataWall.modes.${orgId}`;

/**
 * 上次记下的工作模式。这个接口要 2～3 秒（藕塘社区 40 人实测），拿到之前分不清哪些是床位，
 * 模式又基本不变，所以按机构存本机，进来直接用，后台再更新。只存模式，不存姓名
 */
export function loadSavedSlots(orgId: string): Map<string, Slot> | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(modesKey(orgId)) ?? "null") as Record<string, number> | null;
    return saved ? new Map(Object.entries(saved).map(([sn, mode]) => [sn, { mode }])) : undefined;
  } catch {
    return undefined;
  }
}

export function saveSlots(orgId: string, slots: Map<string, Slot>) {
  try {
    localStorage.setItem(modesKey(orgId), JSON.stringify(Object.fromEntries([...slots].flatMap(([sn, x]) => (x.mode === undefined ? [] : [[sn, x.mode]])))));
  } catch {
    /* 存不下就下次再等接口 */
  }
}

export async function getSlots() {
  const list = (await api.get<PanoramicMember[]>("/api/room/member-panoramic", { params: { pageSize: 1000, pageIndex: 0 } })).data ?? [];
  const out = new Map<string, Slot>();
  for (const m of list) {
    for (const d of m.devices ?? []) {
      const had = out.get(d.sn);
      out.set(d.sn, { mode: d.qlWorkingType ?? had?.mode, realName: had ? undefined : m.realName });
    }
  }
  return out;
}

export type Tone = "alert" | "sleep" | "awake" | "out" | "busy" | "empty" | "none" | "wait";

export interface Cell {
  sn: string;
  label: string;
  tone: Tone;
  /** 浅睡 / 在床 / 离床 18 分 / 有人 · 行走 / 无人 / 离线 / 连接中 / 告警名 */
  state: string;
  heartRate?: number;
  respiratoryRate?: number;
  /** 呼吸暂停 / 呼吸偏快 / 呼吸偏慢 / 体征弱 */
  issue?: string;
  /** 夜里离床太久 */
  longOut?: boolean;
  /** 有没处理的告警，但已经不算紧急（红色只留给紧急的），格子显示真实状态，挂个标记 */
  pending?: string;
  /** 床位（有睡眠、体征的格子） */
  bed: boolean;
}

export interface WallRoom {
  id: string;
  name: string;
  floorKey: string;
  floorLabel: string;
  /** 机构有几栋楼时才有 */
  building?: string;
  alert: boolean;
  cells: Cell[];
}

/** 床位监护、呼吸睡眠模式 */
const BED_MODES = new Set([15, 11]);
/** 12 型（Ultra 呼吸睡眠）只能看床 */
const BED_ONLY_TYPE = 12;
/** 姿态告警要是这么久内看到的，才算人还在那里（人走开后那台设备最后一帧会一直留着） */
const ALARM_HOLD_MS = 60_000;
/** 夜里离床超过这么久，格子加圈 */
const LONG_OUT_MS = 15 * 60_000;
/**
 * 在线设备开始接收后这么久还没推送，就当没人（不在床 / 无人），不再写"连接中"。
 * 2026-11-01 藕塘社区实测：有人在床的设备都在 4 秒内推送；床上没人时设备不推心率呼吸，只偶尔报一帧，第一帧要 8～23 秒才到
 */
const SILENT_MS = 5_000;
/** 监测时段同睡眠报告：晚上 20:00 到早上 08:00 */
const isNight = (t: number) => {
  const h = new Date(t).getHours();
  return h >= 20 || h < 8;
};
const naturally = (a?: string, b?: string) => (a ?? "").localeCompare(b ?? "", "zh-CN", { numeric: true });

function cellOf(
  d: RoomTile["devices"][number],
  roomName: string,
  ctx: { live?: LiveData; link?: DeviceLink; slot?: Slot; alert?: OpsAlert; now: number; listeningSince?: number; showName: boolean; slotsKnown: boolean },
): Cell {
  const { live, slot, alert, now } = ctx;
  const base = bedName(d.deviceName, roomName, d.sn);
  const label = ctx.showName && slot?.realName ? `${slot.realName[0]} · ${base}` : base;
  const cell = (c: Omit<Cell, "sn" | "label">): Cell => {
    if (!alert) return { sn: d.sn, label, ...c };
    if (isUrgent(alert, now)) return { sn: d.sn, label, ...c, tone: "alert", state: alert.alertTypeName };
    return { sn: d.sn, label, ...c, pending: alert.alertTypeName };
  };
  const bed = BED_MODES.has(slot?.mode ?? -1) || d.deviceType === BED_ONLY_TYPE || hasVitals(live);
  if (!live) {
    // 这时的在线状态是平台记录的（设备还没推送过）；核对过是准的，离线的不用等
    if (ctx.link && !ctx.link.online) return cell({ tone: "none", state: "离线", bed });
    const quiet = ctx.listeningSince === undefined ? 0 : now - ctx.listeningSince;
    if (quiet < SILENT_MS) return cell({ tone: "wait", state: "连接中", bed });
    if (quiet > LIVE_STALE_MS) return cell({ tone: "none", state: "离线", bed });
    return cell(bed ? { tone: "out", state: "不在床", bed } : { tone: "empty", state: "无人", bed });
  }
  const v = bedVitals(live, now);
  if (v.state === "stale") return cell({ tone: "none", state: "离线", bed });
  const fresh = live.seenAt !== undefined && now - live.seenAt <= ALARM_HOLD_MS;
  const seen = fresh ? live : { ...live, posture: live.posture !== undefined && ALARM_POSTURES.has(live.posture) ? undefined : live.posture, fall: undefined };
  const ds = deviceState(seen, now);
  if (ds.kind === "alert") return cell({ tone: "alert", state: ds.state, bed, heartRate: v.heartRate, respiratoryRate: v.respiratoryRate, issue: v.issue });
  // 还不知道工作模式（第一次打开、长者列表没回来）：床位雷达没测到体征时会被当成"有人 / 无人"，先不猜
  if (!bed && !ctx.slotsKnown) return cell({ tone: "wait", state: "连接中", bed });
  if (!bed) return cell(ds.people ? { tone: "busy", state: ds.people > 1 ? `${ds.people} 人 · ${ds.state}` : `有人 · ${ds.state}`, bed } : { tone: "empty", state: "无人", bed });
  if (v.state === "in") {
    const asleep = live.sleepStatus === 1 || live.sleepStatus === 2;
    return cell({ tone: asleep ? "sleep" : "awake", state: v.text === "清醒" ? "在床醒着" : v.text, heartRate: v.heartRate, respiratoryRate: v.respiratoryRate, issue: v.issue, bed });
  }
  // 床位雷达打开后一直没测到体征，只知道现在不在床，不知道离开多久
  if (v.state === "none") return cell({ tone: "out", state: "不在床", bed });
  const away = live.outOfBedMinutes ? live.outOfBedMinutes * 60_000 : live.vitalsAt !== undefined ? Math.max(now, live.updatedAt) - live.vitalsAt : 0;
  return cell({ tone: "out", state: v.text, longOut: isNight(now) && away >= LONG_OUT_MS, bed });
}

/** 一直算紧急的告警（直到有人处理）：跌倒、坐地；紧急求助是分组 4 */
const SERIOUS_RE = /跌倒|坐地/;
const SOS_GROUP = 4;
/**
 * 其他告警（离床、久坐等）只在刚发生的这段时间算紧急。
 * 这类告警常积压几小时没人点处理（藕塘社区 2026-11-01 下午 24 小时内有 16 条），一直红的话整面墙都是红的，人回床了也看不出来
 */
const RECENT_MS = 10 * 60_000;
export function isUrgent(a: OpsAlert, now: number) {
  return a.alertTypeGroup === SOS_GROUP || SERIOUS_RE.test(a.alertTypeName) || now - Date.parse(a.createdAt.replace(" ", "T")) <= RECENT_MS;
}

/** 未处理的护理告警里还新鲜的（24 小时内），和监控模式房间变红同一规则；更早的积压不让屏幕一直红 */
export const freshCareAlerts = (pending: OpsAlert[], now: number) =>
  pending.filter((a) => CARE_GROUPS.has(a.alertTypeGroup ?? 0) && now - Date.parse(a.createdAt.replace(" ", "T")) <= ALERT_FRESH_MS);

/** 房间按楼栋、楼层（高层在上）、房间排，位置不随状态变；没绑雷达的房间没有可显示的，不上墙 */
export function buildRooms(
  tiles: RoomTile[],
  live: Record<string, LiveData>,
  links: Map<string, DeviceLink>,
  slots: Map<string, Slot>,
  alerts: OpsAlert[],
  /** listeningSince：实时连接连上的时间；没连上时没有，这时设备没推送说明不了什么 */
  o: { now: number; listeningSince?: number; showName: boolean; slotsKnown: boolean },
): WallRoom[] {
  const bySn = new Map<string, OpsAlert>();
  // 最新在前，每台留最新一条
  // 同一台既有紧急的也有不紧急的，留紧急的
  for (const a of alerts) if (a.sn && (!bySn.has(a.sn) || (isUrgent(a, o.now) && !isUrgent(bySn.get(a.sn)!, o.now)))) bySn.set(a.sn, a);
  const buildings = new Set(tiles.map((t) => t.room.buildingName ?? ""));
  return tiles
    .filter((t) => t.devices.length)
    .sort(
      (a, b) =>
        (a.room.buildingSortOrder ?? 0) - (b.room.buildingSortOrder ?? 0) ||
        naturally(a.room.buildingName, b.room.buildingName) ||
        (b.room.floorNumber ?? 0) - (a.room.floorNumber ?? 0) ||
        naturally(a.room.floorName, b.room.floorName) ||
        naturally(a.room.roomName, b.room.roomName),
    )
    .map((t) => {
      const cells = t.devices
        .map((d) => cellOf(d, t.room.roomName, { live: live[d.sn], link: links.get(d.sn), slot: slots.get(d.sn), alert: bySn.get(d.sn), ...o }))
        .sort((a, b) => Number(b.bed) - Number(a.bed) || naturally(a.label, b.label));
      return {
        id: t.room.id,
        name: t.room.roomName,
        floorKey: `${t.room.buildingName ?? ""}|${t.room.floorName ?? ""}`,
        floorLabel: t.room.floorName ?? "",
        building: buildings.size > 1 ? t.room.buildingName : undefined,
        alert: (!!t.alert && isUrgent(t.alert, o.now)) || cells.some((c) => c.tone === "alert"),
        // 只有一台的非床位房间，房间名就够了，设备名常常只是重复（"1号楼6层男卫生间"）
        cells: cells.length === 1 && !cells[0].bed ? [{ ...cells[0], label: "" }] : cells,
      };
    });
}

export function countCells(rooms: WallRoom[]) {
  const n: Record<Tone, number> = { alert: 0, sleep: 0, awake: 0, out: 0, busy: 0, empty: 0, none: 0, wait: 0 };
  for (const r of rooms) for (const c of r.cells) n[c.tone]++;
  return n;
}

// ---------- 显示设置（每个机构一份，存本机） ----------

export interface WallSettings {
  /** 显示范围：楼栋 "B:楼栋名"、楼层 "F:楼栋名|楼层名"；空 = 全部 */
  scope: string[];
  /** auto = 自动排版（按楼层分行、分栏）；grid = 手动设置一屏几行几列房间 */
  mode: "auto" | "grid";
  rows: number;
  cols: number;
  /** 放不下时：page 翻屏轮播，scroll 自动滚动，shrink 整屏缩小 */
  overflow: "page" | "scroll" | "shrink";
}

/** rows、cols 为 0：还没设过，第一次切到手动时按房间数给初始值（suggestGrid） */
export const DEFAULT_SETTINGS: WallSettings = { scope: [], mode: "auto", rows: 0, cols: 0, overflow: "page" };

/** 正好放下 n 间房的行列，房间格子接近屏幕的宽高比 */
export function suggestGrid(n: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt((n * AREA_W) / AREA_H / ROOM_ASPECT)));
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}

const settingsKey = (orgId: string) => `ops.dataWall.settings.${orgId}`;

export function loadSettings(orgId: string): WallSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(settingsKey(orgId)) ?? "{}") as Partial<WallSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(orgId: string, v: WallSettings) {
  try {
    localStorage.setItem(settingsKey(orgId), JSON.stringify(v));
  } catch {
    /* 只是记住选择 */
  }
}

/** 楼层在不在显示范围里（范围为空 = 全部）。key 是 "楼栋名|楼层名" */
export const inScope = (scope: string[], floorKey: string) => !scope.length || scope.includes(`B:${floorKey.split("|")[0]}`) || scope.includes(`F:${floorKey}`);

/** 设置里的楼栋、楼层树，顺序同墙上 */
export function scopeTree(rooms: WallRoom[]) {
  const buildings = new Map<string, Map<string, string>>();
  for (const r of rooms) {
    const b = r.floorKey.split("|")[0];
    if (!buildings.has(b)) buildings.set(b, new Map());
    buildings.get(b)!.set(r.floorKey, r.floorLabel || "未命名楼层");
  }
  return [...buildings].map(([b, floors]) => ({
    value: `B:${b}`,
    title: b || "未命名楼栋",
    children: [...floors].map(([key, label]) => ({ value: `F:${key}`, title: label })),
  }));
}

// ---------- 排版：舞台是定尺寸的，全部算出来，不用量 DOM ----------

/** 字号单位的上限：手动设成很少的行列时，格子很大，字不跟着无限放大 */
const MAX_U = 3;
const MAX_U_RATIO = 1.6;
/**
 * 按格子实际放得下几行决定显示什么（字最小 11 像素，一行约 14 像素），数据优先：
 * - lg / md / sm：床位名 + 状态 + 心率呼吸（三行）；
 * - xs（两行）：床位名 + 心率呼吸，没有体征的写状态；底色仍然表示睡眠状态；
 * - xxs（一行）：只有床位名和底色。
 */
const tierName = (w: number, h: number) => {
  if (h < 32) return "xxs";
  if (h < 56 || w < 84) return "xs";
  const k = Math.min(w, h / 0.6);
  return k >= 176 ? "lg" : k >= 124 ? "md" : "sm";
};
export interface Tier {
  name: string;
  w: number;
  h: number;
  head: number;
  /** 字号单位（像素）：格子放大、撑宽时取不变形的那个方向 */
  u: number;
}
const tierOf = (w: number, h: number): Tier => {
  const k = Math.min(w, h / 0.6);
  return { name: tierName(w, h), w, h, head: Math.round(Math.max(20, k * 0.13)), u: Math.min(k / 100, MAX_U) };
};
/** 格子从大到小试；最小的还放不下就分屏 */
const CELL_WIDTHS = Array.from({ length: 26 }, (_, i) => 272 - i * 8);
const MIN_W = CELL_WIDTHS[CELL_WIDTHS.length - 1];
/** 滚动时格子不小于这个宽度：要滚动就没必要缩到看不清（这个宽度以上才有状态文字和心率呼吸） */
const SCROLL_MIN_W = 124;
const MAX_COLUMNS = 6;
/** 选定大小后，还有空就撑开，最多撑这么多倍 */
const MAX_STRETCH_W = 1.8;
const MAX_STRETCH_H = 1.3;
/** 排法打分：一层楼被切到两栏很难读；每多一栏略扣分；同一栋楼在一栏里好找，加分 */
const SPLIT_PENALTY = 0.6;
const COLUMN_PENALTY = 0.97;
const ALIGNED_BONUS = 1.3;

/** 舞台里给楼层用的区域 */
const AREA_W = 1856;
const AREA_H = 860;
const COLUMN_GAP = 28;
/** 楼层名那一列（和 wall.css 的 .wall-floor 一致）加间距 */
const FLOOR_W = 96;
const PAD = 8;
const CELL_GAP = 6;
const ROOM_GAP = 10;
const ROW_GAP = 10;
const FLOOR_GAP = 8;
/** 手动行列的初始值按这个房间宽高比算 */
const ROOM_ASPECT = 1.3;

export interface PlacedRoom {
  room: WallRoom;
  cols: number;
  width: number;
  /** 手动行列：房间格子一样大，每个房间的床位格子各算各的 */
  height?: number;
  tier?: Tier;
  /** 手动行列没有楼层那一列，楼层写在房间名前面 */
  title?: string;
}
export interface WallRow {
  /** 楼层的第一行才写楼层名 */
  floor?: string;
  building?: string;
  rooms: PlacedRoom[];
  height: number;
  key: string;
  buildingKey: string;
}
/** 一屏：几栏，每栏几行 */
export type WallPage = WallRow[][];

export interface WallLayout {
  tier: Tier;
  pages: WallPage[];
  /** 手动行列（没有楼层那一列） */
  grid?: boolean;
  /** 内容比屏幕高，自动滚动 */
  scroll?: boolean;
  /** 整屏缩小的比例 */
  scale?: number;
}

const columnWidth = (n: number) => (AREA_W - (n - 1) * COLUMN_GAP) / n;
const roomsWidth = (n: number) => columnWidth(n) - FLOOR_W;
const roomW = (cols: number, w: number) => 2 * PAD + cols * w + (cols - 1) * CELL_GAP;

function buildRows(rooms: WallRoom[], w: number, h: number, head: number, area: number) {
  const rows: WallRow[] = [];
  let x = 0;
  for (const room of rooms) {
    const n = room.cells.length;
    const cols = Math.min(n, Math.max(1, Math.floor((area - 2 * PAD + CELL_GAP) / (w + CELL_GAP))));
    const lines = Math.ceil(n / cols);
    const width = roomW(cols, w);
    const height = 2 * PAD + head + lines * h + (lines - 1) * CELL_GAP;
    const last = rows[rows.length - 1];
    if (last && last.key === room.floorKey && x + ROOM_GAP + width <= area) {
      last.rooms.push({ room, cols, width });
      last.height = Math.max(last.height, height);
      x += ROOM_GAP + width;
    } else {
      const first = last?.key !== room.floorKey;
      rows.push({
        key: room.floorKey,
        buildingKey: room.floorKey.split("|")[0],
        floor: first ? room.floorLabel : undefined,
        building: first ? room.building : undefined,
        rooms: [{ room, cols, width }],
        height,
      });
      x = width;
    }
  }
  return rows;
}

/** 按顺序把行装进栏：放不下换栏；aligned 时每栋楼也从新的一栏开始 */
function packColumns(rows: WallRow[], rooms: WallRoom[], aligned: boolean, maxH = AREA_H) {
  const floorOf = new Map(rooms.map((r) => [r.floorKey, r]));
  const columns: WallRow[][] = [[]];
  let y = 0;
  for (const source of rows) {
    const row = { ...source };
    const col = columns[columns.length - 1];
    const gap = row.floor !== undefined ? FLOOR_GAP + ROW_GAP : ROW_GAP;
    const prev = col[col.length - 1];
    if (prev && (y + gap + row.height > maxH || (aligned && prev.buildingKey !== row.buildingKey))) {
      columns.push([row]);
      y = row.height;
      // 楼层被切到下一栏：这一栏也写楼层名
      if (row.floor === undefined) {
        row.floor = floorOf.get(row.key)?.floorLabel;
        row.building = floorOf.get(row.key)?.building;
      }
    } else {
      y += (prev ? gap : 0) + row.height;
      col.push(row);
    }
  }
  return columns;
}

interface Fit {
  w: number;
  n: number;
  aligned: boolean;
  columns: WallRow[][];
}

/** 分 n 栏时，一屏放得下的最大格子；放不下返回 undefined */
function fitColumns(rooms: WallRoom[], n: number, aligned: boolean, minW: number): Fit | undefined {
  const area = roomsWidth(n);
  for (const w of CELL_WIDTHS) {
    if (w < minW) break;
    if (area < roomW(1, w)) continue;
    const t = tierOf(w, Math.round(w * 0.6));
    const columns = packColumns(buildRows(rooms, w, t.h, t.head, area), rooms, aligned);
    if (columns.length <= n) return { w, n, aligned, columns };
  }
  return undefined;
}

/** 一层楼被切到两栏 */
const splitsFloor = (columns: WallRow[][]) => columns.some((c, i) => i > 0 && columns[i - 1][columns[i - 1].length - 1]?.key === c[0]?.key);

/** 排法的好坏：格子撑开后的面积，切开楼层、栏数多要打折，按楼栋分栏加分 */
function scoreOf(fit: Fit, tier: Tier) {
  return tier.w * tier.h * (splitsFloor(fit.columns) ? SPLIT_PENALTY : 1) * COLUMN_PENALTY ** (fit.n - 1) * (fit.aligned ? ALIGNED_BONUS : 1);
}

/** 一屏放下后，还有空就把格子撑开（整屏同一个比例，上下左右仍然对齐） */
function stretchToFill(fit: Fit): WallLayout {
  const base = tierOf(fit.w, Math.round(fit.w * 0.6));
  const area = roomsWidth(fit.n);
  let kw = MAX_STRETCH_W;
  for (const r of fit.columns.flat()) {
    const cells = r.rooms.reduce((x, p) => x + p.cols, 0);
    const fixed = r.rooms.reduce((x, p) => x + 2 * PAD + (p.cols - 1) * CELL_GAP, 0) + (r.rooms.length - 1) * ROOM_GAP;
    kw = Math.min(kw, (area - fixed) / cells / fit.w);
  }
  let kh = MAX_STRETCH_H;
  for (const c of fit.columns) {
    let cellsH = 0;
    let used = 0;
    c.forEach((r, i) => {
      const lines = (r.height - 2 * PAD - base.head + CELL_GAP) / (base.h + CELL_GAP);
      cellsH += lines * base.h;
      used += r.height + (i ? (r.floor !== undefined ? FLOOR_GAP + ROW_GAP : ROW_GAP) : 0);
    });
    // 格子放大后标题也会高一点，留些余量
    kh = Math.min(kh, (AREA_H - 12 * c.length - (used - cellsH)) / cellsH);
  }
  const tier = tierOf(Math.floor(fit.w * Math.max(1, kw)), Math.floor(base.h * Math.max(1, kh)));
  const columns = fit.columns.map((c) => c.map((r) => ({ ...r, rooms: r.rooms.map((p) => ({ ...p, width: roomW(p.cols, tier.w) })) })));
  return { tier, pages: [columns] };
}

/** 手动行列：一屏 rows 行 cols 列房间，每个房间占一格，床位格子按房间里的数量铺满 */
function layoutGrid(rooms: WallRoom[], setting: WallSettings): WallLayout {
  const v = setting.rows && setting.cols ? setting : { ...setting, ...suggestGrid(rooms.length) };
  const need = Math.ceil(rooms.length / v.cols);
  // 整屏缩小：行列按比例一起加到放得下，房间大小不变，整屏按比例缩小（只加行的话房间会被压扁）
  const f = v.overflow === "shrink" ? Math.max(1, Math.sqrt(rooms.length / (v.rows * v.cols))) : 1;
  const screenRows = Math.ceil(v.rows * f);
  const cols = Math.ceil(v.cols * f);
  const slotW = Math.floor((AREA_W * f - (cols - 1) * ROOM_GAP) / cols);
  const slotH = Math.floor((AREA_H * f - (screenRows - 1) * ROW_GAP) / screenRows);
  const head = Math.round(Math.min(40, Math.max(20, slotH * 0.12)));
  const multi = new Set(rooms.map((r) => r.building)).size > 1;
  const placed = rooms.map((room): PlacedRoom => {
    const n = room.cells.length;
    let best = { cols: 1, w: 0, h: 0, k: -1 };
    for (let c = 1; c <= n; c++) {
      const lines = Math.ceil(n / c);
      const w = Math.floor((slotW - 2 * PAD - (c - 1) * CELL_GAP) / c);
      const h = Math.floor((slotH - 2 * PAD - head - (lines - 1) * CELL_GAP) / lines);
      const k = Math.min(w, h / 0.6);
      if (k > best.k) best = { cols: c, w, h, k };
    }
    const tier = { ...tierOf(Math.max(1, best.w), Math.max(1, best.h)), head };
    return { room, cols: best.cols, width: slotW, height: slotH, tier, title: [multi ? room.building : undefined, room.floorLabel, room.name].filter(Boolean).join(" ") };
  });
  // 同一屏的字号差距不要太大：床位少的房间格子大，但字最多是最小那间的这么多倍
  const minU = Math.min(...placed.map((p) => p.tier!.u));
  for (const p of placed) p.tier!.u = Math.min(p.tier!.u, minU * MAX_U_RATIO);
  const rows: WallRow[] = [];
  for (let i = 0; i < placed.length; i += cols) rows.push({ rooms: placed.slice(i, i + cols), height: slotH, key: `g${i}`, buildingKey: "" });
  const base = tierOf(Math.min(slotW, slotH), slotH);
  if (v.overflow === "scroll") return { tier: base, pages: [[rows]], grid: true, scroll: need > v.rows };
  const pages: WallPage[] = [];
  for (let i = 0; i < rows.length; i += screenRows) pages.push([rows.slice(i, i + screenRows)]);
  return { tier: base, pages: pages.length ? pages : [[[]]], grid: true, scale: f > 1 ? 1 / f : undefined };
}

function computeLayout(rooms: WallRoom[], v: WallSettings): WallLayout {
  if (v.mode === "grid") return layoutGrid(rooms, v);
  const buildings = new Set(rooms.map((r) => r.floorKey.split("|")[0])).size;
  const minW = v.overflow === "scroll" ? SCROLL_MIN_W : MIN_W;
  let best: (WallLayout & { score: number }) | undefined;
  for (let n = 1; n <= MAX_COLUMNS; n++) {
    for (const aligned of buildings > 1 ? [true, false] : [false]) {
      const fit = fitColumns(rooms, n, aligned, minW);
      if (!fit) continue;
      const r = stretchToFill(fit);
      const score = scoreOf(fit, r.tier);
      if (!best || score > best.score) best = { ...r, score };
    }
  }
  if (best) return best;
  if (v.overflow === "scroll") {
    const tier = tierOf(SCROLL_MIN_W, Math.round(SCROLL_MIN_W * 0.6));
    const columns = packColumns(buildRows(rooms, tier.w, tier.h, tier.head, roomsWidth(1)), rooms, false, Infinity);
    return { tier, pages: [columns], scroll: true };
  }
  const tier = tierOf(MIN_W, Math.round(MIN_W * 0.6));
  if (v.overflow === "shrink") {
    // 缩小后屏幕相当于变大了：从大到小试比例和栏数，取放得下的第一个
    for (let k = 0.95; k > 0.1; k -= 0.05) {
      for (let n = 1; n <= MAX_COLUMNS; n++) {
        const area = (AREA_W / k - (n - 1) * COLUMN_GAP) / n - FLOOR_W;
        if (area < roomW(1, tier.w)) continue;
        const columns = packColumns(buildRows(rooms, tier.w, tier.h, tier.head, area), rooms, false, AREA_H / k);
        if (columns.length <= n) return { tier, pages: [columns], scale: k };
      }
    }
  }
  // 翻屏：栏数取翻屏最少的（栏太窄时一行只放得下一个房间，反而更费屏）
  let pages: WallPage[] = [];
  for (let n = 1; n <= MAX_COLUMNS; n++) {
    const columns = packColumns(buildRows(rooms, tier.w, tier.h, tier.head, roomsWidth(n)), rooms, false);
    const count = Math.ceil(columns.length / n);
    if (!pages.length || count < pages.length) {
      pages = Array.from({ length: count }, (_, i) => columns.slice(i * n, (i + 1) * n));
    }
  }
  return { tier, pages };
}

let cached: { key: string; layout: WallLayout } | undefined;

/** 选排法。这里每秒都会调用，排法只取决于房间、格子数量和设置，没变就不重算，只换上最新的房间状态 */
export function layoutWall(rooms: WallRoom[], v: WallSettings): WallLayout {
  const key = `${v.mode},${v.rows},${v.cols},${v.overflow};` + rooms.map((r) => `${r.id}:${r.cells.length}:${r.floorKey}`).join(",");
  if (cached?.key !== key) cached = { key, layout: computeLayout(rooms, v) };
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const { layout } = cached;
  return { ...layout, pages: layout.pages.map((cols) => cols.map((c) => c.map((row) => ({ ...row, rooms: row.rooms.map((p) => ({ ...p, room: byId.get(p.room.id)! })) })))) };
}

/** 整屏缩小到这个比例以下，字在大屏上也不容易看清 */
const SMALL_SCALE = 0.6;

/** 格子太小、内容显示不全时的提醒（写在工具栏和设置里，不上墙） */
export function layoutHint(layout: WallLayout) {
  const names = new Set(layout.pages.flat(2).flatMap((row) => row.rooms.map((p) => (p.tier ?? layout.tier).name)));
  if (names.has("xxs")) return "格子太小，部分床位只能显示床位名和颜色。可以减少行列数，或把“放不下时”改成翻屏、滚动。";
  if (layout.scale !== undefined && layout.scale < SMALL_SCALE) return `已缩小到 ${Math.round(layout.scale * 100)}%，字可能看不清。可以把“放不下时”改成翻屏或滚动。`;
  return undefined;
}
