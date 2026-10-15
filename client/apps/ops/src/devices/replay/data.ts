import { api } from "@radar/core";

/**
 * 姿态回放的数据层（移植自油猴脚本 room-posture-replay.user.js，算法保持一致）：
 * 任选时间段（可跨天，最多 7 天），合并轨迹点、姿态时间段和进出事件，按目标（设备 + userId）分组。
 */

export const GAP_MS = 2000; // 与平台轨迹回放一致：相邻点超过 2 秒视为断开
export const STALE_MS = 10 * 60 * 1000; // 无轨迹但仍有姿态时，最多沿用 10 分钟内的最后位置
export const MAX_RANGE_DAYS = 7;

/** 姿态配色：告警姿态用红 / 橙系，与客户端状态色一致 */
export const POSTURES: Record<number, { text: string; color: string; alarm?: boolean }> = {
  1: { text: "行走", color: "#1F9D55" },
  2: { text: "疑似跌倒", color: "#E8590C", alarm: true },
  3: { text: "坐", color: "#D97706" },
  4: { text: "静止", color: "#9AA0B8" },
  5: { text: "跌倒确认", color: "#D93036", alarm: true },
  6: { text: "在床", color: "#3B4FD8" },
  7: { text: "疑似坐地", color: "#F08C00", alarm: true },
  8: { text: "确认坐地告警", color: "#B4232A", alarm: true },
  9: { text: "床上坐起", color: "#7048E8" },
  10: { text: "疑似床上坐起告警", color: "#D6336C", alarm: true },
  11: { text: "确认床上坐起告警", color: "#A61E4D", alarm: true },
};

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
  devices?: { sn: string; deviceName?: string; isOnline?: boolean }[];
}

export async function getRoomDetail(roomId: string) {
  return (await api.get<RoomDetail>("/api/room-view/v3/detail", { params: { roomId } })).data;
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

type Res =
  | { kind: "traj"; data: { x: number; y: number; timestamp: number; sn: string; userId: number }[] }
  | { kind: "posture"; sn: string; data: { segments?: { posture: number; userId: number; startAt: string; endAt: string }[] } }
  | { kind: "event"; sn: string; data: { events?: { eventType: number; userId: number; occurredAt: string; rangeName?: string }[] } };

export async function loadReplayData(
  roomId: string,
  detail: RoomDetail,
  start: number,
  end: number,
  sns: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<ReplayData> {
  const devices = (detail.devices ?? []).filter((d) => d.sn);
  const nameOf = Object.fromEntries(devices.map((d) => [d.sn, d.deviceName || d.sn]));
  // 姿态 / 事件接口单次不能超过 24 小时，按天拆开查
  const chunks = splitRange(start, end);
  const get = async <T,>(path: string, params: Record<string, string>) => (await api.get<T>(path, { params })).data;
  const tasks: (() => Promise<Res>)[] = [];
  for (const [s, e] of chunks) {
    tasks.push(() =>
      get<Extract<Res, { kind: "traj" }>["data"]>("/api/human-exists/trajectory-points", { roomId, startAt: fmt(s), endAt: fmt(e), deviceSns: sns.join(",") }).then(
        (data) => ({ kind: "traj", data: data ?? [] }),
      ),
    );
  }
  for (const sn of sns) {
    for (const [s, e] of chunks) {
      tasks.push(() =>
        get<Extract<Res, { kind: "posture" }>["data"]>("/api/device/human-position/posture-timeline", { sn, startAt: fmt(s), endAt: fmt(e) }).then((data) => ({
          kind: "posture",
          sn,
          data: data ?? {},
        })),
      );
      tasks.push(() =>
        get<Extract<Res, { kind: "event" }>["data"]>("/api/device/human-position/event-timeline", { sn, startAt: fmt(s), endAt: fmt(e) }).then((data) => ({
          kind: "event",
          sn,
          data: data ?? {},
        })),
      );
    }
  }
  const results = await runLimited(tasks, 4, onProgress);
  const errors = results.filter((r): r is Error => r instanceof Error);
  const trajErr = results.slice(0, chunks.length).find((r) => r instanceof Error);
  if (trajErr) throw trajErr;

  const trackMap = new Map<string, Omit<Track, "runs" | "color" | "label">>();
  const getTrack = (sn: string, uid: number) => {
    const key = `${sn}:${uid}`;
    let tr = trackMap.get(key);
    if (!tr) trackMap.set(key, (tr = { key, sn, uid, points: [], postures: [] }));
    return tr;
  };
  const seen = new Set<string>();
  const events: ReplayData["events"] = [];
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
    } else {
      for (const ev of r.data.events ?? []) {
        events.push({ t: parseTime(ev.occurredAt), sn: r.sn, uid: ev.userId, type: ev.eventType, range: ev.rangeName });
      }
    }
  }

  // 坐标系：AIO 等设备的历史点已是房间坐标；FallSense 等设备是相对雷达的坐标，需要按安装配置换算。
  // 每台设备分别试两种解释，落在房间内的点多的那种即为正确的坐标系。
  const qcBySn: Record<string, QingLan> = {};
  for (const el of detail.elements ?? []) if (el.sn && el.qingLanConfig?.container) qcBySn[el.sn] = el.qingLanConfig;
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
      tr.points.sort((a, b) => a.t - b.t);
      tr.postures.sort((a, b) => a.s - b.s);
      const runs: [number, number][] = [];
      for (const p of tr.points) {
        const last = runs[runs.length - 1];
        if (last && p.t - last[1] < GAP_MS) last[1] = p.t;
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
  for (const tr of tracks) {
    for (const seg of tr.postures) {
      const def = POSTURES[seg.p];
      if (def?.alarm) marks.push({ t: seg.s, color: def.color, text: `${tr.label} ${def.text}`, alarm: true });
    }
  }
  marks.sort((a, b) => a.t - b.t);

  const allTs: number[] = [];
  for (const tr of tracks) for (const p of tr.points) allTs.push(p.t);
  allTs.sort((a, b) => a - b);

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
}

/** 某时刻的位置：2 秒内的点做线性插值；超出则沿用最近位置（标记为 stale） */
export function trackStateAt(tr: Track, t: number): TrackState | null {
  const pts = tr.points;
  const posture = postureAt(tr, t);
  const i = lowerBound(pts, t + 1, (p) => p.t) - 1;
  if (i < 0) return posture ? { posture, x: null, y: null, stale: true } : null;
  const a = pts[i];
  const age = t - a.t;
  if (age > GAP_MS) {
    if (posture && age < STALE_MS) return { posture, x: a.x, y: a.y, stale: true };
    return posture ? { posture, x: null, y: null, stale: true } : null;
  }
  let x = a.x;
  let y = a.y;
  const b = pts[i + 1];
  if (b && b.t > a.t && b.t - a.t < GAP_MS) {
    const k = (t - a.t) / (b.t - a.t);
    x = a.x + (b.x - a.x) * k;
    y = a.y + (b.y - a.y) * k;
  }
  return { posture, x, y, stale: false };
}
