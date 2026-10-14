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

/** 睡眠分段状态：1 清醒，2 眼动，3 浅睡，4 深睡，7 离床 */
export const SLEEP_STAGE: Record<number, { key: string; label: string; color: string }> = {
  4: { key: "deep", label: "深睡", color: "#3B4FD8" },
  3: { key: "light", label: "浅睡", color: "#8EA0FF" },
  2: { key: "rem", label: "眼动", color: "#B48CF2" },
  1: { key: "awake", label: "清醒", color: "#F5C26B" },
  7: { key: "leave", label: "离床", color: "#E5484D" },
};

export interface SleepSegment {
  status: number;
  startTime: number;
  endTime: number;
}

export interface SleepReport {
  memberId: string;
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
