import { useEffect, useState } from "react";
import type { CareAlert, Member } from "./api";
import { minutesText, type SleepReport } from "./health";

/**
 * 今日需关注：客户端自己判断，不用平台的需关注名单（平台加工出来的应用层结果可能有问题）。
 * 依据只用设备产生的数据：按设备来源的昨夜睡眠报告、设备上报的告警。
 * 阈值可以在界面上设置（"需关注规则"），保存在本机。
 */
export interface AttentionRules {
  /** 未处理的跌倒告警算需关注 */
  fallAlert: boolean;
  /** 睡眠评分低于此值；0 表示不启用 */
  lowScore: number;
  /** 夜间睡眠少于此小时数；0 表示不启用 */
  shortSleepHours: number;
  /** 夜间离床达到此次数；0 表示不启用 */
  frequentLeaveBed: number;
  /** 呼吸紊乱指数（AHI）达到此值；0 表示不启用。5–15 轻度，15–30 中度，30 以上重度 */
  highAhi: number;
}

export const DEFAULT_RULES: AttentionRules = {
  fallAlert: true,
  lowScore: 60,
  shortSleepHours: 5,
  frequentLeaveBed: 3,
  highAhi: 15,
};

// ---------- 规则存储（本机 localStorage，改动后所有页面同步刷新） ----------

const KEY = "RC_ATTENTION_RULES";
const listeners = new Set<(r: AttentionRules) => void>();

function load(): AttentionRules {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...DEFAULT_RULES, ...saved };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

let current = load();

export function getAttentionRules() {
  return current;
}

export function saveAttentionRules(r: AttentionRules) {
  current = { ...r };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* 存不下也照常生效到本次运行结束 */
  }
  listeners.forEach((l) => l(current));
}

export function useAttentionRules() {
  const [r, setR] = useState(current);
  useEffect(() => {
    listeners.add(setR);
    return () => void listeners.delete(setR);
  }, []);
  return r;
}

// ---------- 判断 ----------

export interface AttentionItem {
  memberId: string;
  realName: string;
  bedName?: string;
  /** 需关注的原因，已带数值，例如"睡眠评分 37 分" */
  reasons: string[];
  /** 排序用：越大越需要先看 */
  weight: number;
}

/** 一位长者的需关注原因 */
export function attentionReasons(
  report: SleepReport | undefined,
  pending: CareAlert[],
  R: AttentionRules = current,
): { reasons: string[]; weight: number } {
  const reasons: string[] = [];
  let weight = 0;
  if (R.fallAlert) {
    const falls = pending.filter((a) => a.alertTypeName.includes("跌倒"));
    if (falls.length) {
      reasons.push(falls.length > 1 ? `${falls.length} 条跌倒告警未处理` : "跌倒告警未处理");
      weight += 100;
    }
  }
  if (report) {
    if (R.lowScore > 0 && report.sleepScore !== undefined && report.sleepScore < R.lowScore) {
      reasons.push(`睡眠评分 ${report.sleepScore} 分`);
      weight += 10 + (R.lowScore - report.sleepScore) / 10;
    }
    const total = report.totalNightSleepMinutes ?? report.totalSleepMinutes;
    if (R.shortSleepHours > 0 && total !== undefined && total > 0 && total < R.shortSleepHours * 60) {
      reasons.push(`睡眠只有 ${minutesText(total)}`);
      weight += 8;
    }
    if (R.frequentLeaveBed > 0 && (report.leaveBedCount ?? 0) >= R.frequentLeaveBed) {
      reasons.push(`夜间离床 ${report.leaveBedCount} 次`);
      weight += 6;
    }
    if (R.highAhi > 0 && report.ahi !== undefined && report.ahi >= R.highAhi) {
      reasons.push(`呼吸紊乱指数 ${report.ahi}`);
      weight += 6;
    }
  }
  return { reasons, weight };
}

/** 全部长者的需关注名单，按严重程度排序 */
export function buildAttention(
  members: Member[],
  reports: Map<string, SleepReport> | undefined,
  pendingAlerts: CareAlert[],
  R: AttentionRules = current,
) {
  const pendingBy = new Map<string, CareAlert[]>();
  for (const a of pendingAlerts) for (const m of a.members ?? []) pendingBy.set(m.memberId, [...(pendingBy.get(m.memberId) ?? []), a]);
  const items: AttentionItem[] = [];
  for (const m of members) {
    const { reasons, weight } = attentionReasons(reports?.get(m.memberId), pendingBy.get(m.memberId) ?? [], R);
    if (reasons.length) items.push({ memberId: m.memberId, realName: m.realName, bedName: m.bedName, reasons, weight });
  }
  items.sort((a, b) => b.weight - a.weight);
  return { total: items.length, items };
}

/** 各条规则单独命中的人数（设置弹窗里用来预览阈值的效果） */
export function ruleHits(members: Member[], reports: Map<string, SleepReport> | undefined, pendingAlerts: CareAlert[], R: AttentionRules) {
  const only = (patch: Partial<AttentionRules>) =>
    buildAttention(members, reports, pendingAlerts, { fallAlert: false, lowScore: 0, shortSleepHours: 0, frequentLeaveBed: 0, highAhi: 0, ...patch }).total;
  return {
    fallAlert: R.fallAlert ? only({ fallAlert: true }) : 0,
    lowScore: only({ lowScore: R.lowScore }),
    shortSleepHours: only({ shortSleepHours: R.shortSleepHours }),
    frequentLeaveBed: only({ frequentLeaveBed: R.frequentLeaveBed }),
    highAhi: only({ highAhi: R.highAhi }),
    total: buildAttention(members, reports, pendingAlerts, R).total,
  };
}
