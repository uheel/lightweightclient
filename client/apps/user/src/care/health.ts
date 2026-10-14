import { api } from "@radar/core";
import type { CareAlert } from "./api";

/**
 * 长者健康数据（只读）。字段已用真实数据核对过（2026-10-14）：
 * - 时长单位是分钟，sleepDetails 的时间是毫秒时间戳
 * - 心率 / 呼吸趋势从入睡时间开始，每 10 分钟一个点，<= 0 表示没有数据
 */

export interface MemberInfo {
  realName: string;
  gender?: number;
  age?: number;
  phoneNumber?: string;
  checkedInAt?: string;
}

export async function getMemberInfo(memberId: string) {
  return (await api.get<MemberInfo>("/api/member/info", { params: { memberId } })).data;
}

export type StageKey = "deep" | "light" | "rem" | "awake" | "leave" | "latency";

export const STAGES: Record<StageKey, { label: string; color: string }> = {
  deep: { label: "深睡", color: "#3B4FD8" },
  light: { label: "浅睡", color: "#8EA0FF" },
  rem: { label: "眼动", color: "#B48CF2" },
  awake: { label: "清醒", color: "#F5C26B" },
  leave: { label: "离床", color: "#E5484D" },
  latency: { label: "入睡潜伏", color: "#C9CEDF" },
};
export const STAGE_ORDER: StageKey[] = ["deep", "light", "rem", "awake", "leave", "latency"];

/**
 * 睡眠分段 status 编码：平台健康模块的枚举（common 模块 27905 的 sH），
 * 与真实数据核对一致（按分段累计的时长与汇总字段吻合）：
 * 1 深睡，2 浅睡，3 清醒，4 离床，5 眼动，6 入睡潜伏期
 */
const PLATFORM: Record<number, StageKey> = { 1: "deep", 2: "light", 3: "awake", 4: "leave", 5: "rem", 6: "latency" };

function segMinutes(segs: SleepSegment[], codes: Record<number, StageKey>) {
  const m: Partial<Record<StageKey, number>> = {};
  for (const s of segs) {
    const k = codes[s.status];
    if (k) m[k] = (m[k] ?? 0) + Math.max(s.endTime - s.startTime, 0) / 60_000;
  }
  return m;
}

export function stageCodesOf(_r?: SleepReport): Record<number, StageKey> {
  return PLATFORM;
}

/** 各阶段时长（分钟）：有分段明细时按明细统计，否则用汇总字段 */
export function stageMinutesOf(r: SleepReport, codes: Record<number, StageKey>): Record<StageKey, number | undefined> {
  const segs = r.sleepDetails ?? [];
  if (segs.length) {
    const m = segMinutes(segs, codes);
    return { deep: m.deep ?? 0, light: m.light ?? 0, rem: m.rem ?? 0, awake: m.awake ?? 0, leave: m.leave ?? 0, latency: m.latency ?? 0 };
  }
  return { deep: r.deepSleepMinutes, light: r.lightSleepMinutes, rem: r.remSleepMinutes, awake: r.awakeMinutes, leave: r.outOfBedMinutes, latency: undefined };
}

/** 报告缺少入睡 / 醒来时间、离床次数时，从分段明细推算 */
export function derivedTimes(r: SleepReport, codes: Record<number, StageKey>) {
  const segs = [...(r.sleepDetails ?? [])].sort((a, b) => a.startTime - b.startTime);
  const asleep = segs.filter((s) => ["deep", "light", "rem"].includes(codes[s.status]));
  const fmt = (t?: number) => (t === undefined ? undefined : new Date(t));
  return {
    fallAsleep: r.fallAsleepTime ? hm(r.fallAsleepTime) : asleep.length ? hmOf(fmt(asleep[0].startTime)!) : "—",
    wakeUp: r.wakeUpTime ? hm(r.wakeUpTime) : asleep.length ? hmOf(fmt(asleep[asleep.length - 1].endTime)!) : "—",
    leaveBedCount: r.leaveBedCount ?? (segs.length ? segs.filter((s) => codes[s.status] === "leave").length : undefined),
  };
}

function hmOf(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export interface SleepSegment {
  status: number;
  startTime: number;
  endTime: number;
}

export interface SleepReport {
  memberId: string;
  realName?: string;
  buildingName?: string;
  floorName?: string;
  roomName?: string;
  bedName?: string;
  /** 报告来源，见 SLEEP_SOURCES */
  reportSource?: number;
  sleepScoreText?: string;
  sleepDescription?: string;
  /** 每分钟心率 / 呼吸（sleep-report 接口自带，毫秒时间戳） */
  hrPoints?: { t: number; v: number }[];
  brPoints?: { t: number; v: number }[];
  reportDate: string;
  sleepScore?: number;
  bedTime?: string;
  fallAsleepTime?: string;
  wakeUpTime?: string;
  getUpTime?: string;
  totalSleepMinutes?: number;
  totalNightSleepMinutes?: number;
  deepSleepMinutes?: number;
  lightSleepMinutes?: number;
  remSleepMinutes?: number;
  awakeMinutes?: number;
  outOfBedMinutes?: number;
  /** 睡眠效率 % */
  sleepEfficiency?: number;
  /** 在床时长（分钟） */
  timeInBed?: number;
  leaveBedCount?: number;
  avgBreathingRate?: number;
  avgHeartRate?: number;
  ahi?: number;
  ahiEvaluation?: string;
  sleepDetails?: SleepSegment[];
  breathingTrend?: number[];
  heartRateTrend?: number[];
}

export interface HealthOverview {
  reportDate: string;
  summary?: { inHospitalElderCount?: number; validMonitoringCount?: number; todayAttentionCount?: number };
  attentionTotal?: number;
  reports: SleepReport[];
}

/**
 * 机构内所有长者"昨夜"的睡眠报告与概况（健康驾驶舱的数据源，带评分、效率、趋势）。
 * 一次取整个机构，缓存 10 分钟，长者详情和健康总览共用。
 */
let overviewCache: { orgId: string; at: number; data: Promise<HealthOverview> } | null = null;

export function getHealthOverview(orgId: string, force = false) {
  if (!force && overviewCache && overviewCache.orgId === orgId && Date.now() - overviewCache.at < 10 * 60_000) return overviewCache.data;
  const data = api
    .get<{ reportDate: string; summary?: HealthOverview["summary"]; attentionTotal?: number; sleepReports?: SleepReport[] }>(
      "/api/cockpit/v2/elder/dashboard",
      { params: { reportLimit: 1000, rankingLimit: 1, attentionLimit: 1 } },
    )
    .then((r) => ({ reportDate: r.data?.reportDate ?? "", summary: r.data?.summary, attentionTotal: r.data?.attentionTotal, reports: r.data?.sleepReports ?? [] }));
  overviewCache = { orgId, at: Date.now(), data };
  data.catch(() => (overviewCache = null));
  return data;
}

export async function getLastNightReports(orgId: string) {
  const o = await getHealthOverview(orgId);
  return new Map(o.reports.map((x) => [x.memberId, x]));
}

/** 单个长者某一天的睡眠分期（健康画像接口；没有评分，用于驾驶舱里没有这位长者时兜底） */
export async function getPortraitSleep(memberId: string, date: string) {
  const r = await api.get<{ sleepReport?: Omit<SleepReport, "memberId" | "reportDate"> }>("/api/health/portrait-report", {
    params: { memberId, date },
  });
  const s = r.data?.sleepReport;
  return s && (s.totalSleepMinutes || s.sleepDetails?.length) ? ({ ...s, memberId, reportDate: date } as SleepReport) : undefined;
}

/** 近期告警（含已处理）：平台的告警列表不支持按长者筛选，取最近 200 条在本地过滤 */
export async function getRecentAlertsOf(memberId: string) {
  const groups = [1, 2, 4];
  const res = await Promise.all(
    groups.map((g) =>
      api.get<CareAlert[]>("/api/alert/pages", { params: { current: 1, pageSize: 200 }, filter: { alertTypeGroup: g } }),
    ),
  );
  return res
    .flatMap((r) => r.data ?? [])
    .filter((a) => a.members?.some((m) => m.memberId === memberId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
}

/** 分钟 → "5 时 12 分" */
export function minutesText(m?: number) {
  if (m === undefined || m === null || !Number.isFinite(m)) return "—";
  const v = Math.max(0, Math.round(m));
  const h = Math.floor(v / 60);
  return h ? `${h} 时 ${String(v % 60).padStart(2, "0")} 分` : `${v} 分钟`;
}

/** "2026-10-13 23:19:46" → "23:19" */
export function hm(t?: string) {
  return t ? t.slice(11, 16) : "—";
}

export function scoreLevel(score?: number) {
  if (score === undefined) return { text: "暂无评分", color: "#8A8FA8" };
  if (score >= 80) return { text: "睡得不错", color: "#17794A" };
  if (score >= 70) return { text: "一般", color: "#3B4FD8" };
  if (score >= 60) return { text: "偏低", color: "#9A5B00" };
  return { text: "需要关注", color: "#B4232A" };
}

export interface VitalPoint {
  /** 毫秒时间戳 */
  t: number;
  hr?: number;
  rr?: number;
}

/** 每分钟心率呼吸（按时间范围查询，已实测 filter[minuteAt]=开始,结束 可用） */
export async function getVitalMinutes(memberId: string, start: number, end: number): Promise<VitalPoint[]> {
  const f = (t: number) => {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
  };
  const r = await api.get<{ minuteAt: string; heartRateAverage?: number; respiratoryRateAverage?: number }[]>(
    "/api/member/data/radar-vital-minute-pages",
    { params: { current: 1, pageSize: 1500 }, filter: { memberId, minuteAt: `${f(start)},${f(end)}` } },
  );
  return (r.data ?? [])
    .map((x) => ({
      t: Date.parse(x.minuteAt.replace(" ", "T")),
      hr: x.heartRateAverage && x.heartRateAverage > 0 ? x.heartRateAverage : undefined,
      rr: x.respiratoryRateAverage && x.respiratoryRateAverage > 0 ? x.respiratoryRateAverage : undefined,
    }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t);
}

/**
 * 雷达位置（姿态时间线）。注意两个坑（2026-10-14 实测）：
 * - 接口不传 userId 时只返回目标 1。雷达给每个跟踪到的人编号，人离开后再回来常会变成新编号
 *   （例如起床后回到床上从目标 1 变成目标 2），同屋有别人时也会同时有多个目标，所以要按编号逐个查
 * - 单次查询不能超过 24 小时
 */
export interface PostureSeg {
  userId: number;
  posture: number;
  start: number;
  end: number;
}

const MAX_TARGETS = 6;

export async function getPostureTimeline(sns: string[], start: number, end: number): Promise<PostureSeg[]> {
  const fmt = (t: number) => {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const jobs = sns.flatMap((sn) =>
    Array.from({ length: MAX_TARGETS }, (_, i) =>
      api
        .get<{ segments?: { posture: number; userId: number; startAt: string; endAt: string }[] }>("/api/device/human-position/posture-timeline", {
          params: { sn, startAt: fmt(start), endAt: fmt(end), userId: i + 1 },
        })
        .then((r) => r.data?.segments ?? [])
        .catch(() => []),
    ),
  );
  const all = (await Promise.all(jobs)).flat();
  return all
    .map((s) => ({ userId: s.userId, posture: s.posture, start: Date.parse(s.startAt.replace(" ", "T")), end: Date.parse(s.endAt.replace(" ", "T")) }))
    .filter((s) => !Number.isNaN(s.start) && !Number.isNaN(s.end) && s.end > s.start);
}

/** 在床的姿态：6 在床，9 床上坐起，10 / 11 床上坐起告警 */
const IN_BED_POSTURES = new Set([6, 9, 10, 11]);

export type RadarPresence = "bed" | "room" | "none";

export const RADAR_PRESENCE: Record<RadarPresence, { label: string; color: string }> = {
  bed: { label: "在床", color: "#2E9F6B" },
  room: { label: "在房间（不在床）", color: "#E08A3C" },
  none: { label: "未检测到人", color: "#F1F2F7" },
};

export interface PresenceRun {
  state: RadarPresence;
  start: number;
  end: number;
  /** 这段时间里同时跟踪到的最多目标数 */
  targets: number;
}

/**
 * 合并所有目标，按分钟得到雷达位置：任一目标在床 → 在床；有目标但都不在床 → 在房间；没有目标 → 未检测到人。
 * 连续相同状态合并成一段。
 */
export function presenceRuns(segs: PostureSeg[], start: number, end: number): PresenceRun[] {
  const MIN = 60_000;
  const n = Math.max(0, Math.ceil((end - start) / MIN));
  const bed = new Uint8Array(n);
  const any = new Uint8Array(n);
  const ids: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const s of segs) {
    const a = Math.max(0, Math.floor((s.start - start) / MIN));
    const b = Math.min(n, Math.ceil((s.end - start) / MIN));
    for (let i = a; i < b; i++) {
      any[i] = 1;
      ids[i].add(s.userId);
      if (IN_BED_POSTURES.has(s.posture)) bed[i] = 1;
    }
  }
  const runs: PresenceRun[] = [];
  for (let i = 0; i < n; i++) {
    const state: RadarPresence = bed[i] ? "bed" : any[i] ? "room" : "none";
    const last = runs[runs.length - 1];
    if (last && last.state === state) {
      last.end = start + (i + 1) * MIN;
      last.targets = Math.max(last.targets, ids[i].size);
    } else runs.push({ state, start: start + i * MIN, end: start + (i + 1) * MIN, targets: ids[i].size });
  }
  return runs;
}

/**
 * 睡眠报告来源（平台枚举 gX）：网页端"报告记录"里的 睡眠-AIO / 戒指 / Ultra / 手表 / UltraFall / Ultra Plus。
 * 每位长者用哪个来源，取决于他绑定的设备类型。
 */
export const SLEEP_SOURCES: Record<number, string> = { 1: "AIO", 2: "戒指", 3: "Ultra", 4: "手表", 5: "UltraFall", 6: "Ultra Plus" };

/** 设备类型 → 睡眠报告来源（设备类型枚举：6 AIO，12 Ultra 呼吸睡眠，13 UltraFall，15 Ultra Plus） */
const SOURCE_BY_DEVICE_TYPE: Record<number, number> = { 6: 1, 12: 3, 13: 5, 15: 6 };
/** 雷达类来源要带 windowMinutes=1（与网页端一致） */
const RADAR_SOURCES = new Set([1, 3, 5, 6]);

export function sourcesOf(member: { devices?: { deviceType?: number }[] }) {
  const set = new Set<number>();
  for (const d of member.devices ?? []) {
    const s = d.deviceType !== undefined ? SOURCE_BY_DEVICE_TYPE[d.deviceType] : undefined;
    if (s) set.add(s);
  }
  return [...set];
}

interface RawSleepReport {
  reportDate: string;
  reportSource?: number;
  sleepScore?: number;
  sleepScoreText?: string;
  sleepDescription?: string;
  bedTime?: string;
  fallAsleepTime?: string;
  wakeUpTime?: string;
  getUpTime?: string;
  sleepSummary?: Partial<SleepReport>;
  metrics?: { sleepEfficiency?: number; timeInBed?: number; leaveBedCount?: number; awakeCount?: number; avgHeartRate?: number; avgBreathingRate?: number; ahi?: number; ahiEvaluation?: string };
  sleepDetails?: SleepSegment[];
  heartRate?: { timestamp: number; value?: number }[];
  breathingRate?: { timestamp: number; value?: number }[];
}

/** 某位长者某天、某个来源的睡眠报告（/api/health/sleep-report，带评分、指标、分段和每分钟心率呼吸） */
export async function getSleepReport(memberId: string, date: string, source: number): Promise<SleepReport | undefined> {
  const r = await api.get<RawSleepReport | null>("/api/health/sleep-report", {
    params: { memberId, date, source, windowMinutes: RADAR_SOURCES.has(source) ? 1 : undefined },
  });
  const d = r.data;
  if (!d || !(d.sleepDetails?.length || d.sleepSummary?.totalSleepMinutes)) return undefined;
  const pts = (xs?: { timestamp: number; value?: number }[]) => (xs ?? []).flatMap((x) => (x.value && x.value > 0 ? [{ t: x.timestamp, v: x.value }] : []));
  const m = d.metrics ?? {};
  return {
    ...d.sleepSummary,
    memberId,
    reportDate: d.reportDate ?? date,
    reportSource: d.reportSource ?? source,
    sleepScore: d.sleepScore || undefined,
    sleepScoreText: d.sleepScoreText,
    sleepDescription: d.sleepDescription,
    bedTime: d.bedTime,
    fallAsleepTime: d.fallAsleepTime,
    wakeUpTime: d.wakeUpTime,
    getUpTime: d.getUpTime,
    sleepEfficiency: m.sleepEfficiency,
    timeInBed: m.timeInBed,
    leaveBedCount: m.leaveBedCount,
    avgHeartRate: m.avgHeartRate,
    avgBreathingRate: m.avgBreathingRate,
    ahi: m.ahi,
    ahiEvaluation: m.ahiEvaluation,
    sleepDetails: d.sleepDetails,
    hrPoints: pts(d.heartRate),
    brPoints: pts(d.breathingRate),
  };
}

/**
 * 长者某天的睡眠报告：按绑定设备对应的来源依次查（多台设备时取第一份有数据的），
 * 都没有时再用健康画像兜底（没有评分）。date 是报告日期（醒来那天）。
 */
export async function getMemberSleepReport(member: { memberId: string; devices?: { deviceType?: number }[] }, date: string) {
  for (const s of sourcesOf(member)) {
    const r = await getSleepReport(member.memberId, date, s).catch(() => undefined);
    if (r) return r;
  }
  return getPortraitSleep(member.memberId, date).catch(() => undefined);
}

/** 并发受限地对一组任务求值（避免一次发出几十个请求） */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>, onProgress?: (done: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
        onProgress?.(++done);
      }
    }),
  );
  return out;
}

/**
 * 机构内所有长者某天的睡眠报告：逐个长者按其设备对应的来源查询（并发 4 个）。
 * 驾驶舱接口只返回 AIO 来源的报告，用 Ultra / UltraFall 等设备的长者会漏掉，所以不用它做列表。
 * 注意：平台在某份报告第一次被请求时才生成，首次可能要几秒到几十秒，之后约 100ms；所以不设超时。
 * 结果按 机构 + 日期 缓存 10 分钟。
 */
let orgReportCache: { key: string; at: number; data: Promise<SleepReport[]> } | null = null;

export function getOrgSleepReports(
  orgId: string,
  members: { memberId: string; realName?: string; bedName?: string; devices?: { deviceType?: number }[] }[],
  date: string,
  force = false,
  onProgress?: (done: number) => void,
) {
  const key = `${orgId}|${date}|${members.length}`;
  if (!force && orgReportCache && orgReportCache.key === key && Date.now() - orgReportCache.at < 10 * 60_000) return orgReportCache.data;
  const data = mapLimit(
    members,
    4,
    async (m): Promise<SleepReport | undefined> => {
      const r = await getMemberSleepReport(m, date).catch(() => undefined);
      return r ? { ...r, realName: r.realName ?? m.realName, bedName: r.bedName ?? m.bedName } : undefined;
    },
    onProgress,
  ).then((xs) => xs.filter((x): x is SleepReport => !!x));
  orgReportCache = { key, at: Date.now(), data };
  data.catch(() => (orgReportCache = null));
  return data;
}
