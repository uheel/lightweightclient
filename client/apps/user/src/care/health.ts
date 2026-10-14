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

export type StageKey = "deep" | "light" | "rem" | "awake" | "leave";

export const STAGES: Record<StageKey, { label: string; color: string }> = {
  deep: { label: "深睡", color: "#3B4FD8" },
  light: { label: "浅睡", color: "#8EA0FF" },
  rem: { label: "眼动", color: "#B48CF2" },
  awake: { label: "清醒", color: "#F5C26B" },
  leave: { label: "离床", color: "#E5484D" },
};
export const STAGE_ORDER: StageKey[] = ["deep", "light", "rem", "awake", "leave"];

/**
 * 睡眠分段 status 的编码（2026-10-14 用藕塘社区、象屿慈爱共 16 份真实报告核对，按分段累计的深睡 / 浅睡 / 眼动时长与汇总字段误差在几分钟内）：
 * - 实际数据（青岚雷达，reportSource 1 和 5 都是）：1 深睡，2 浅睡，3 清醒，4 离床，5 眼动
 * - 网页端代码里的定义（标准）：1 清醒，2 眼动，3 浅睡，4 深睡，7 离床。和实际数据对不上，网页端的睡眠结构颜色因此是错的
 * 这里先用分段与汇总字段比对来判断，以后有设备真的按"标准"编码上报，也能自动识别。
 * 汇总里的清醒 / 离床只算入睡后的部分，所以这两项与分段累计可能差得较多，判断时以深睡 / 浅睡 / 眼动为主。
 */
const STANDARD: Record<number, StageKey> = { 1: "awake", 2: "rem", 3: "light", 4: "deep", 7: "leave" };
const QINGLAN: Record<number, StageKey> = { 1: "deep", 2: "light", 3: "awake", 4: "leave", 5: "rem" };

function segMinutes(segs: SleepSegment[], codes: Record<number, StageKey>) {
  const m: Partial<Record<StageKey, number>> = {};
  for (const s of segs) {
    const k = codes[s.status];
    if (k) m[k] = (m[k] ?? 0) + Math.max(s.endTime - s.startTime, 0) / 60_000;
  }
  return m;
}

/** 判断一份报告用的是哪套编码：拿分段累计时长和汇总字段比，误差小的就是 */
export function stageCodesOf(r: SleepReport & { reportSource?: number }): Record<number, StageKey> {
  const segs = r.sleepDetails ?? [];
  if (segs.some((s) => s.status === 5)) return QINGLAN;
  const summary: Partial<Record<StageKey, number | undefined>> = {
    deep: r.deepSleepMinutes,
    light: r.lightSleepMinutes,
    rem: r.remSleepMinutes,
    awake: r.awakeMinutes,
    leave: r.outOfBedMinutes,
  };
  const known = STAGE_ORDER.filter((k) => summary[k] !== undefined);
  if (segs.length && known.length >= 3) {
    const err = (codes: Record<number, StageKey>) => {
      const m = segMinutes(segs, codes);
      return known.reduce((n, k) => n + Math.abs((m[k] ?? 0) - (summary[k] ?? 0)), 0);
    };
    return err(QINGLAN) < err(STANDARD) ? QINGLAN : STANDARD;
  }
  return r.reportSource === 5 ? QINGLAN : STANDARD;
}

/** 各阶段时长（分钟）：有分段明细时按明细统计，否则用汇总字段 */
export function stageMinutesOf(r: SleepReport, codes: Record<number, StageKey>): Record<StageKey, number | undefined> {
  const segs = r.sleepDetails ?? [];
  if (segs.length) {
    const m = segMinutes(segs, codes);
    return { deep: m.deep ?? 0, light: m.light ?? 0, rem: m.rem ?? 0, awake: m.awake ?? 0, leave: m.leave ?? 0 };
  }
  return { deep: r.deepSleepMinutes, light: r.lightSleepMinutes, rem: r.remSleepMinutes, awake: r.awakeMinutes, leave: r.outOfBedMinutes };
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
  /** 报告来源：1 标准，5 青岚雷达（决定睡眠分段的编码） */
  reportSource?: number;
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

/**
 * 机构内所有长者"昨夜"的睡眠报告（健康驾驶舱的数据源，带评分、效率、趋势）。
 * 一次取整个机构，缓存 10 分钟，打开不同长者的详情不重复请求。
 */
let reportCache: { orgId: string; at: number; data: Promise<Map<string, SleepReport>> } | null = null;

export function getLastNightReports(orgId: string) {
  if (reportCache && reportCache.orgId === orgId && Date.now() - reportCache.at < 10 * 60_000) return reportCache.data;
  const data = api
    .get<{ reportDate: string; sleepReports?: SleepReport[] }>("/api/cockpit/v2/elder/dashboard", {
      params: { reportLimit: 1000, rankingLimit: 1, attentionLimit: 1 },
    })
    .then((r) => new Map((r.data?.sleepReports ?? []).map((x) => [x.memberId, x])));
  reportCache = { orgId, at: Date.now(), data };
  data.catch(() => (reportCache = null));
  return data;
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
