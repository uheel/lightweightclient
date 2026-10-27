import { api, type PerfTimer } from "@radar/core";
import { getAllDeviceLogs, isSlim, type DeviceLog } from "../../api/device";
import { getRoomView } from "../../api/roomView";

/**
 * 姿态回放的数据层（移植自油猴脚本 room-posture-replay.user.js，算法保持一致）：
 * 任选时间段（可跨天，最多 7 天），合并轨迹点、姿态时间段和进出事件，按目标（设备 + userId）分组。
 */

/**
 * 相邻两点间隔在这个时长内视为同一段连续轨迹，回放时在两点之间按时间插值移动。
 * 平台轨迹回放按 2 秒断开；历史轨迹点约 1 秒一个，但常有几秒的缺口，按 2 秒断开时目标会在实心 / 半透明之间闪，缺口后一下跳过去。
 */
export const LINK_MS = 10_000;
/** 一段轨迹最后一个点之后，位置再保留这么久（淡出），超过且没有姿态就视为不在场 */
export const HOLD_MS = 3000;
export const STALE_MS = 10 * 60 * 1000; // 无轨迹但仍有姿态时，最多沿用 10 分钟内的最后位置
export const MAX_RANGE_DAYS = 7;

/**
 * 姿态配色：告警姿态用红 / 橙系，与客户端状态色一致。
 * 行走、坐、静止、在床是平常姿态；其他姿态都有对应的场景告警，开始时刻算一个事件（event）。注意"坐"（3）和"床上坐起"（9）是两个姿态。
 */
export const POSTURES: Record<number, { text: string; color: string; alarm?: boolean; event?: boolean }> = {
  1: { text: "行走", color: "#1F9D55" },
  2: { text: "疑似跌倒", color: "#E8590C", alarm: true, event: true },
  3: { text: "坐", color: "#D97706" },
  4: { text: "静止", color: "#9AA0B8" },
  5: { text: "跌倒确认", color: "#D93036", alarm: true, event: true },
  6: { text: "在床", color: "#3B4FD8" },
  7: { text: "疑似坐地", color: "#F08C00", alarm: true, event: true },
  8: { text: "确认坐地告警", color: "#B4232A", alarm: true, event: true },
  9: { text: "床上坐起", color: "#7048E8", event: true },
  10: { text: "疑似床上坐起告警", color: "#D6336C", alarm: true, event: true },
  11: { text: "确认床上坐起告警", color: "#A61E4D", alarm: true, event: true },
};

/**
 * 场景告警记录（事件分组）也算事件：离床告警不是姿态，只能从这里来；
 * 跌倒、坐地、坐起的姿态段有时缺失（2026-10-14 坐起测试有跌倒 / 坐地告警，同时段姿态时间线为空），也用告警补上。
 * 同一设备 1 分钟内已有同类姿态事件的告警不重复列出。
 */
const ALERT_COLOR = "#C2255C";
const ALERT_DEDUP_MS = 60_000;
const eventKind = (text: string) => ["跌倒", "坐地", "坐起"].find((k) => text.includes(k));

export const EVENTS: Record<number, { text: string; color: string }> = {
  1: { text: "进入房间", color: "#1F9D55" },
  2: { text: "离开房间", color: "#8A8FA8" },
  3: { text: "进入区域", color: "#3B4FD8" },
  4: { text: "离开区域", color: "#8C9BF5" },
  5: { text: "进入监护区", color: "#7048E8" },
  6: { text: "退出监护区", color: "#B197FC" },
};

export const TRACK_COLORS = ["#3B4FD8", "#1F9D55", "#D97706", "#7048E8", "#0C8599", "#D6336C", "#5C940D", "#556FF7"];

// ---------- 房间详情（平面图） ----------

export interface QingLan {
  container: { x: number; y: number; width?: number; height?: number };
  radar?: { x: number; y: number };
  installType?: number;
  installDirection?: number;
  ranges?: { type: number; text?: string; x: number; y: number; width: number; height: number; fill?: string }[];
}

export interface RoomEl {
  type: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
  src?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  text?: string;
  fontSize?: number;
  points?: number[];
  sn?: string;
  qingLanConfig?: QingLan;
  children?: RoomEl[];
}

export interface RoomDetail {
  roomId: string;
  roomName?: string;
  buildingName?: string;
  floorName?: string;
  background?: { width?: number; height?: number; fill?: string; stroke?: string; strokeWidth?: number; src?: string };
  elements?: RoomEl[];
  devices?: { sn: string; deviceName?: string; deviceType?: number; isOnline?: boolean }[];
}

export async function getRoomDetail(roomId: string) {
  return getRoomView<RoomDetail>(roomId);
}

// ---------- 工具 ----------

const pad = (n: number) => String(n).padStart(2, "0");
export const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const fmt = (ms: number) => {
  const d = new Date(ms);
  return `${fmtDate(d)} ${fmtTime(d)}`;
};
const parseTime = (s: string) => new Date(String(s).replace(" ", "T")).getTime();
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** 第一个 key(item) >= v 的下标 */
export function lowerBound<T>(arr: T[], v: number, key?: (x: T) => number) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((key ? key(arr[mid]) : (arr[mid] as unknown as number)) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function runLimited<T>(tasks: (() => Promise<T>)[], limit: number, onProgress?: (done: number, total: number) => void) {
  const results: (T | Error)[] = new Array(tasks.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        results[i] = e instanceof Error ? e : new Error(String(e));
      }
      onProgress?.(++done, tasks.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function splitRange(start: number, end: number, maxMs = 864e5) {
  const out: [number, number][] = [];
  for (let s = start; s < end; s += maxMs) out.push([s, Math.min(end, s + maxMs)]);
  return out;
}

// ---------- 数据 ----------

/** 间隔在这个时长内的轨迹点算同一次上报 */
const BURST_MS = 300;

/**
 * 合并一次上报里的多个点（取平均位置和时间）。
 * Ultra 跌倒监测终端每 2 秒存两个相隔约 2 ms、位置差 10–30 cm 的点（2026-10-19 藕塘社区 11 房实测，几千对都是这样），
 * 不合并的话回放时每 2 秒瞬移一下再滑 2 秒，看着一顿一顿的；一体化终端约 1 秒一个点，不受影响
 */
function mergeBursts(pts: Track["points"]): Track["points"] {
  const out: Track["points"] = [];
  let group: Track["points"] = [];
  const flush = () => {
    if (!group.length) return;
    const n = group.length;
    out.push({
      t: Math.round(group.reduce((a, p) => a + p.t, 0) / n),
      x: group.reduce((a, p) => a + p.x, 0) / n,
      y: group.reduce((a, p) => a + p.y, 0) / n,
    });
    group = [];
  };
  for (const p of pts) {
    if (group.length && p.t - group[0].t > BURST_MS) flush();
    group.push(p);
  }
  flush();
  return out;
}

export interface Track {
  key: string;
  sn: string;
  uid: number;
  points: { t: number; x: number; y: number }[];
  postures: { s: number; e: number; p: number }[];
  /** 连续出现区间，用于时间轴底色 */
  runs: [number, number][];
  color: string;
  label: string;
}

export interface Mark {
  t: number;
  color: string;
  text: string;
  alarm: boolean;
}

export interface ReplayData {
  tracks: Track[];
  events: { t: number; sn: string; uid: number; type: number; range?: string }[];
  marks: Mark[];
  allTs: number[];
  converted: string[];
  warnings: string[];
}

/**
 * 一体化终端（6 型）上报的原始轨迹帧（Device.postevent 的 event_QL_rawdata，0x81 帧，有人时每个目标约 1 秒一帧）：
 * 第 4 字节目标数、第 5 字节目标编号、第 6 字节 0x58 = 没人、第 7 / 8 字节 x / y（有符号，分米，相对雷达）、第 19 字节姿态、第 20 字节人员事件、第 21 字节事件区域 ID（255 = 不在区域）。
 * 目标编号不等于历史轨迹点的 userId（平台自己跟踪编号：16:03～16:07 帧里只有 1 号目标，轨迹点一直是 userId 2），按位置对：轨迹点 x = 帧 x × 10、y = −帧 y × 10（厘米）。
 * 格式和实测见 docs/site-analysis.md"持续时间与久坐提醒"。
 */
interface Frame {
  t: number;
  x: number;
  y: number;
  posture: number;
  event: number;
  area: number;
}
const signed = (b: number) => (b << 24) >> 24;

function decodeFrames(logs: DeviceLog[]): Frame[] {
  const out: Frame[] = [];
  for (const l of logs) {
    let msg: { params?: unknown };
    try {
      msg = JSON.parse(l.rawData ?? "");
    } catch {
      continue;
    }
    for (const p of (Array.isArray(msg.params) ? msg.params : [msg.params]) as { event_QL_rawdata?: number[][]; Timestamp?: number }[]) {
      if (!p?.event_QL_rawdata) continue;
      const t = p.Timestamp ? p.Timestamp * 1000 : parseTime(l.createdAt);
      for (const f of p.event_QL_rawdata) {
        if (f.length >= 22 && f[3] === 0x81 && f[6] !== 0x58)
          out.push({ t, x: signed(f[7]) * 10, y: -signed(f[8]) * 10, posture: f[19], event: f[20], area: f[21] });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** 帧里同一目标同一姿态、间隔在这个时长内的算一段 */
const FRAME_GAP_MS = 3000;
/** 帧和轨迹点按时间配对的容差 */
const FRAME_MATCH_MS = 1500;
/** 平台姿态 / 事件时间线不可靠的时段：有 userId 从 2 起的轨迹 */
const FIRST_MISSED_UID = 2;

type Res =
  | { kind: "traj"; data: { x: number; y: number; timestamp: number; sn: string; userId: number }[] }
  | { kind: "posture"; sn: string; data: { segments?: { posture: number; userId: number; startAt: string; endAt: string }[] } }
  | { kind: "event"; sn: string; data: { events?: { eventType: number; userId: number; occurredAt: string; rangeName?: string }[] } }
  | { kind: "alert"; data: { alertTypeName?: string; alertTypeColor?: string; sn?: string; createdAt: string }[] };

/**
 * 平台的姿态 / 事件时间线在多人时不可靠（2026-10-21 距离测试 …6711）：一条上报里有几个目标时只记第一个，坐着的人姿态、进区域事件全都没有；
 * 而且记在帧的目标编号下，和轨迹点的 userId 对不上。轨迹点倒是都有。所以出现 userId 2 起的轨迹的时段，姿态和进出事件全部改从设备原始帧解，
 * 每帧按时间 + 位置对到最近的轨迹点所在目标。这里拉这些时段的原始上报
 */
async function loadFrameLogs(pts: { timestamp: number; sn: string; userId: number }[], sns: string[]) {
  const spans: { sn: string; a: number; b: number }[] = [];
  for (const sn of sns) {
    const ts = pts.filter((p) => p.sn === sn && p.userId >= FIRST_MISSED_UID).map((p) => p.timestamp).sort((a, b) => a - b);
    for (const t of ts) {
      const last = spans[spans.length - 1];
      if (last && last.sn === sn && t - last.b <= LINK_MS) last.b = t;
      else spans.push({ sn, a: t, b: t });
    }
  }
  // 每个时段内部已经是并发分页，时段之间再并发 2 个，别把请求槽全占了
  return runLimited(
    spans.map(({ sn, a, b }) => () =>
      getAllDeviceLogs({ sn, command: "Device.postevent", range: [fmt(a - 5000), fmt(b + 5000)], pageSize: 200, max: Math.ceil((b - a) / 1000) * 3 + 200 }).then((r) => ({ sn, list: r.list })),
    ),
    2,
  );
}

/**
 * 同一份查询正在加载时直接复用：打开回溯时自动查今天，开发模式下这个 effect 会跑两遍，
 * 两份一样的查询同时打平台，每个请求都慢一倍（2026-10-27 藕塘 perf 日志里每个请求都成对出现）
 */
const inflight = new Map<string, Promise<ReplayData>>();

export function loadReplayData(
  roomId: string,
  detail: RoomDetail,
  start: number,
  end: number,
  sns: string[],
  onProgress?: (done: number, total: number) => void,
  pt?: PerfTimer,
): Promise<ReplayData> {
  const key = JSON.stringify([roomId, Math.floor(start / 1000), Math.floor(end / 1000), sns]);
  let p = inflight.get(key);
  if (!p) {
    p = loadReplayDataOnce(roomId, detail, start, end, sns, onProgress, pt).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

async function loadReplayDataOnce(
  roomId: string,
  detail: RoomDetail,
  start: number,
  end: number,
  sns: string[],
  onProgress?: (done: number, total: number) => void,
  pt?: PerfTimer,
): Promise<ReplayData> {
  const devices = (detail.devices ?? []).filter((d) => d.sn);
  const nameOf = Object.fromEntries(devices.map((d) => [d.sn, d.deviceName || d.sn]));
  // 姿态 / 事件接口单次不能超过 24 小时，按天拆开查
  const chunks = splitRange(start, end);
  const get = async <T,>(path: string, params: Record<string, string>) => (await api.get<T>(path, { params })).data;
  // 轨迹点按设备、每 6 小时拆开并发查：一次查整个房间一天，藕塘 5 台 24 小时是 32 MB / 43 万个点，
  // 平台处理 2.8 秒 + 下载 3 秒，比所有时间线都慢（2026-10-27 perf 日志）
  const trajChunks = splitRange(start, end, 6 * 36e5);
  const total = trajChunks.length * sns.length + chunks.length * sns.length * 2 + 1;
  let done = 0;
  const tick = <T,>(v: T) => (onProgress?.(++done, total), v);

  const tasks: (() => Promise<Res>)[] = [];
  for (const sn of sns) {
    for (const [s, e] of chunks) {
      tasks.push(() =>
        get<Extract<Res, { kind: "event" }>["data"]>("/api/device/human-position/event-timeline", { sn, startAt: fmt(s), endAt: fmt(e) }).then((data) => ({
          kind: "event",
          sn,
          data: data ?? {},
        })),
      );
      tasks.push(() =>
        get<Extract<Res, { kind: "posture" }>["data"]>("/api/device/human-position/posture-timeline", { sn, startAt: fmt(s), endAt: fmt(e) }).then((data) => ({
          kind: "posture",
          sn,
          data: data ?? {},
        })),
      );
    }
  }
  // 告警记录可以跨天查。平台不认 filter[sn]（试过 sn / deviceSn / sns 等都返回整个机构的），所以整段查一次，本地按设备筛
  tasks.push(() =>
    api
      .getAll<Extract<Res, { kind: "alert" }>["data"][number]>("/api/alert/pages", {
        pageSize: 200,
        max: 5000,
        filter: { alertTypeGroup: 2, createdAt: `${fmt(start)},${fmt(end)}` },
      })
      .then((res) => ({ kind: "alert", data: res.data ?? [] })),
  );
  // 时间线先发：请求槽（Rust GATE，6 个、先到先得）先给它们，轨迹分片排在后面。反过来的话时间线要在 20 个轨迹分片后面排 2 秒多队
  // （2026-10-27 藕塘 5 台 24 小时：时间线排队 2.3 秒，本身只要约 1 秒）
  const timelinesP = runLimited(tasks, tasks.length, () => tick(0));

  // 轨迹点先单独查：一回来就开始拉多人时段的原始帧，和上面的姿态 / 事件时间线同时进行。
  // 事件时间线是最慢的（2026-10-27 藕塘社区 10 小时一台 2.4～5.8 秒，都是平台处理时间），以前要等它查完才开始拉帧
  type TrajPt = Extract<Res, { kind: "traj" }>["data"][number];
  const trajP = Promise.all(
    sns.flatMap((sn) =>
      trajChunks.map(([s, e]) => get<TrajPt[]>("/api/human-exists/trajectory-points", { roomId, startAt: fmt(s), endAt: fmt(e), deviceSns: sn }).then((d) => tick(d ?? []))),
    ),
  ).then((rs) => rs.flat());
  // 原始帧只有 6 型这类上报 event_QL_rawdata 的设备能解；13 / 15 型（Ultra）走另一套报文，帧解不出来，
  // 以前照样下载（藕塘 10 小时一台 7～15 MB、3～6 秒）然后什么都没用上
  const typeOf = Object.fromEntries(devices.map((d) => [d.sn, d.deviceType]));
  const frameSns = sns.filter((sn) => !isSlim(typeOf[sn]));
  const framesP = trajP.then(
    (pts) => loadFrameLogs(pts, frameSns),
    () => [],
  );

  const [traj, results] = await Promise.all([trajP, timelinesP]);
  pt?.lap("fetch");
  pt?.info("requests", tasks.length + trajChunks.length * sns.length);
  const errors = results.filter((r): r is Error => r instanceof Error);
  results.push({ kind: "traj", data: traj });

  const trackMap = new Map<string, Omit<Track, "runs" | "color" | "label">>();
  const getTrack = (sn: string, uid: number) => {
    const key = `${sn}:${uid}`;
    let tr = trackMap.get(key);
    if (!tr) trackMap.set(key, (tr = { key, sn, uid, points: [], postures: [] }));
    return tr;
  };
  const seen = new Set<string>();
  const events: ReplayData["events"] = [];
  const alerts: { t: number; sn: string; name: string; color?: string }[] = [];
  for (const r of results) {
    if (!r || r instanceof Error) continue;
    if (r.kind === "traj") {
      for (const p of r.data) {
        if (!sns.includes(p.sn)) continue;
        const k = `${p.sn}:${p.userId}:${p.timestamp}`;
        if (seen.has(k)) continue;
        seen.add(k);
        getTrack(p.sn, p.userId).points.push({ t: p.timestamp, x: p.x, y: p.y });
      }
    } else if (r.kind === "posture") {
      for (const seg of r.data.segments ?? []) {
        getTrack(r.sn, seg.userId).postures.push({ s: parseTime(seg.startAt), e: parseTime(seg.endAt) + 999, p: seg.posture });
      }
    } else if (r.kind === "alert") {
      for (const a of r.data) {
        if (a.sn && sns.includes(a.sn)) alerts.push({ t: parseTime(a.createdAt), sn: a.sn, name: a.alertTypeName || "告警", color: a.alertTypeColor });
      }
    } else {
      for (const ev of r.data.events ?? []) {
        events.push({ t: parseTime(ev.occurredAt), sn: r.sn, uid: ev.userId, type: ev.eventType, range: ev.rangeName });
      }
    }
  }

  const qcBySn: Record<string, QingLan> = {};
  for (const el of detail.elements ?? []) if (el.sn && el.qingLanConfig?.container) qcBySn[el.sn] = el.qingLanConfig;

  {
    const logs = await framesP;
    pt?.lap("frames");
    for (const r of logs) {
      if (r instanceof Error) {
        errors.push(new Error(`多人时目标 2 起的姿态没补上：${r.message}`));
        continue;
      }
      const frames = decodeFrames(r.list);
      if (!frames.length) continue;
      const a = frames[0].t;
      const b = frames[frames.length - 1].t + 999;
      const ranges = qcBySn[r.sn]?.ranges;
      const tracksOfSn = [...trackMap.values()].filter((tr) => tr.sn === r.sn);
      // 这一段里平台的姿态、事件作废，换成帧里的（跨段边界的姿态段截掉段内部分）
      for (const tr of tracksOfSn)
        tr.postures = tr.postures.flatMap((s) => {
          if (s.e < a || s.s > b) return [s];
          return [...(s.s < a ? [{ ...s, e: a - 1 }] : []), ...(s.e > b ? [{ ...s, s: b + 1 }] : [])];
        });
      for (let i = events.length - 1; i >= 0; i--) if (events[i].sn === r.sn && events[i].t >= a && events[i].t <= b) events.splice(i, 1);
      const sorted = tracksOfSn.map((tr) => ({ tr, pts: [...tr.points].sort((p, q) => p.t - q.t) }));
      const owner = (f: Frame) => {
        let best: { tr: (typeof sorted)[number]["tr"]; d: number } | undefined;
        for (const { tr, pts } of sorted) {
          for (let i = lowerBound(pts, f.t - FRAME_MATCH_MS, (p) => p.t); i < pts.length && pts[i].t <= f.t + FRAME_MATCH_MS; i++) {
            const d = Math.hypot(pts[i].x - f.x, pts[i].y - f.y);
            if (!best || d < best.d) best = { tr, d };
          }
        }
        return best?.tr;
      };
      const open = new Map<string, { s: number; e: number; p: number }>();
      const made: { e: number }[] = [];
      for (const f of frames) {
        const tr = owner(f);
        if (!tr) continue;
        const seg = open.get(tr.key);
        if (seg && seg.p === f.posture && f.t - seg.e <= FRAME_GAP_MS) seg.e = f.t;
        else if (f.posture) {
          const next = { s: f.t, e: f.t, p: f.posture };
          tr.postures.push(next);
          made.push(next);
          open.set(tr.key, next);
        }
        if (EVENTS[f.event]) events.push({ t: f.t, sn: r.sn, uid: tr.uid, type: f.event, range: f.area === 255 ? undefined : (ranges?.[f.area]?.text ?? `区域 ${f.area}`) });
      }
      // 段尾和平台一样按"最后一个样本 + 1 秒"算
      for (const s of made) s.e += 999;
    }
  }

  // 坐标系：AIO 等设备的历史点已是房间坐标；FallSense 等设备是相对雷达的坐标，需要按安装配置换算。
  // 每台设备分别试两种解释，落在房间内的点多的那种即为正确的坐标系。
  const bg = detail.background ?? {};
  const inRoom = (x: number, y: number) => x >= -30 && y >= -30 && x <= (bg.width ?? 0) + 30 && y <= (bg.height ?? 0) + 30;
  const converted: string[] = [];
  for (const sn of sns) {
    const qc = qcBySn[sn];
    const pts = [...trackMap.values()].filter((tr) => tr.sn === sn).flatMap((tr) => tr.points);
    if (!qc || !pts.length) continue;
    let rawIn = 0;
    let xfIn = 0;
    for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 2000))) {
      if (inRoom(pts[i].x, pts[i].y)) rawIn++;
      const [X, Y] = radarToRoom(qc, pts[i].x, pts[i].y);
      if (inRoom(X, Y)) xfIn++;
    }
    if (xfIn > rawIn) {
      for (const p of pts) [p.x, p.y] = radarToRoom(qc, p.x, p.y);
      converted.push(nameOf[sn] || sn);
    }
  }

  const multiDevice = sns.length > 1;
  const tracks: Track[] = [...trackMap.values()]
    .sort((a, b) => (a.sn === b.sn ? a.uid - b.uid : a.sn < b.sn ? -1 : 1))
    .map((tr, i) => {
      tr.points = mergeBursts(tr.points.sort((a, b) => a.t - b.t));
      tr.postures.sort((a, b) => a.s - b.s);
      const runs: [number, number][] = [];
      for (const p of tr.points) {
        const last = runs[runs.length - 1];
        if (last && p.t - last[1] <= LINK_MS) last[1] = p.t;
        else runs.push([p.t, p.t]);
      }
      return {
        ...tr,
        runs,
        color: TRACK_COLORS[i % TRACK_COLORS.length],
        label: multiDevice ? `${nameOf[tr.sn] || tr.sn} · 目标${tr.uid}` : `目标${tr.uid}`,
      };
    });
  const labelOf = Object.fromEntries(tracks.map((tr) => [tr.key, tr.label]));
  events.sort((a, b) => a.t - b.t);

  const marks: Mark[] = [];
  for (const ev of events) {
    const def = EVENTS[ev.type] ?? { text: `事件${ev.type}`, color: "#8A8FA8" };
    const who = labelOf[`${ev.sn}:${ev.uid}`] ?? (multiDevice ? `${nameOf[ev.sn]} · 目标${ev.uid}` : `目标${ev.uid}`);
    marks.push({ t: ev.t, color: def.color, text: `${who} ${def.text}${ev.range ? " · " + ev.range : ""}`, alarm: false });
  }
  const postureEvents: { t: number; sn: string; kind?: string }[] = [];
  for (const tr of tracks) {
    tr.postures.forEach((seg, i) => {
      const def = POSTURES[seg.p];
      // 同一姿态被切成相邻的几段时只算一次
      const prev = tr.postures[i - 1];
      if (!def?.event || (prev && prev.p === seg.p && seg.s - prev.e <= 2000)) return;
      marks.push({ t: seg.s, color: def.color, text: `${tr.label} ${def.text}`, alarm: !!def.alarm });
      postureEvents.push({ t: seg.s, sn: tr.sn, kind: eventKind(def.text) });
    });
  }
  for (const a of alerts) {
    const kind = eventKind(a.name);
    if (kind && postureEvents.some((e) => e.sn === a.sn && e.kind === kind && Math.abs(e.t - a.t) <= ALERT_DEDUP_MS)) continue;
    const color = a.color && /^#[0-9a-f]{3,8}$/i.test(a.color) ? a.color : ALERT_COLOR;
    marks.push({ t: a.t, color, text: `${multiDevice ? (nameOf[a.sn] || a.sn) + " " : ""}${a.name}`, alarm: true });
  }
  marks.sort((a, b) => a.t - b.t);

  const allTs: number[] = [];
  for (const tr of tracks) for (const p of tr.points) allTs.push(p.t);
  allTs.sort((a, b) => a - b);

  pt?.lap("process");
  pt?.info("points", allTs.length);
  pt?.info("tracks", tracks.length);
  return { tracks, events, marks, allTs, converted, warnings: errors.map((e) => e.message) };
}

/**
 * 雷达坐标（cm）→ 房间坐标。与平台实时页面的换算一致（RoomViewPage 模块 1922），
 * 但历史接口的 y 轴与实时数据方向相反，需先取反。已用实时显示位置逐点核对过（侧装 / 方向右）。
 */
export function radarToRoom(qc: QingLan, x: number, y: number): [number, number] {
  const cx = (qc.radar?.x ?? 0) + qc.container.x;
  const cy = (qc.radar?.y ?? 0) + qc.container.y;
  const yr = -y;
  const dir = qc.installDirection;
  let X = cx;
  let Y = cy;
  if (qc.installType === 0) {
    // 顶装
    if (dir === 1) [X, Y] = [cx + x, cy - yr];
    else if (dir === 3) [X, Y] = [cx - x, cy + yr];
    else if (dir === 2) [X, Y] = [cx + yr, cy + x];
    else if (dir === 4) [X, Y] = [cx - yr, cy - x];
  } else {
    // 侧装
    if (dir === 1) [X, Y] = [cx - x, cy + yr];
    else if (dir === 3) [X, Y] = [cx + x, cy - yr];
    else if (dir === 2) [X, Y] = [cx - yr, cy - x];
    else if (dir === 4) [X, Y] = [cx + yr, cy + x];
  }
  return [X, Y];
}

export function postureAt(tr: Track, t: number) {
  const i = lowerBound(tr.postures, t + 1, (s) => s.s) - 1;
  return i >= 0 && t <= tr.postures[i].e ? tr.postures[i].p : null;
}

export interface TrackState {
  posture: number | null;
  x: number | null;
  y: number | null;
  stale: boolean;
  /** 不透明度：段末保留期间逐渐淡出 */
  alpha: number;
}

type Pt = Track["points"][number];
/** 两点是否属于同一段连续轨迹（之间可以插值） */
export const linked = (a: Pt | undefined, b: Pt | undefined) => !!a && !!b && b.t > a.t && b.t - a.t <= LINK_MS;

/** 点 i 处的速度（cm/ms），只用与它相连的邻点 */
function velocity(pts: Pt[], i: number): [number, number] {
  const p = pts[i - 1];
  const c = pts[i];
  const n = pts[i + 1];
  const lp = linked(p, c);
  const ln = linked(c, n);
  const a = lp ? p : c;
  const b = ln ? n : c;
  if (a === b) return [0, 0];
  return [(b.x - a.x) / (b.t - a.t), (b.y - a.y) / (b.t - a.t)];
}

/** 相连的两点 i、i+1 之间按时间插值（三次 Hermite，经过每个点且速度连续，转弯不会一顿一顿） */
export function interpAt(pts: Pt[], i: number, t: number): [number, number] {
  const a = pts[i];
  const b = pts[i + 1];
  const h = b.t - a.t;
  const s = clamp((t - a.t) / h, 0, 1);
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const [vax, vay] = velocity(pts, i);
  const [vbx, vby] = velocity(pts, i + 1);
  return [h00 * a.x + h10 * h * vax + h01 * b.x + h11 * h * vbx, h00 * a.y + h10 * h * vay + h01 * b.y + h11 * h * vby];
}

/**
 * 某时刻的位置：相邻两点间隔在 LINK_MS 以内时按时间插值；
 * 段末最后一个点之后保留 HOLD_MS 并淡出；再往后有姿态时沿用最近位置（标记为 stale），否则视为不在场。
 */
export function trackStateAt(tr: Track, t: number): TrackState | null {
  const pts = tr.points;
  const posture = postureAt(tr, t);
  const i = lowerBound(pts, t + 1, (p) => p.t) - 1;
  if (i < 0) return posture ? { posture, x: null, y: null, stale: true, alpha: 1 } : null;
  const a = pts[i];
  if (linked(a, pts[i + 1])) {
    const [x, y] = interpAt(pts, i, t);
    return { posture, x, y, stale: false, alpha: 1 };
  }
  const age = t - a.t;
  if (age <= HOLD_MS) return { posture, x: a.x, y: a.y, stale: false, alpha: posture ? 1 : 1 - (0.8 * age) / HOLD_MS };
  if (posture && age < STALE_MS) return { posture, x: a.x, y: a.y, stale: true, alpha: 1 };
  return posture ? { posture, x: null, y: null, stale: true, alpha: 1 } : null;
}
