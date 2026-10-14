import type { CareAlert, Member } from "./api";
import { minutesText, type SleepReport } from "./health";

/**
 * 今日需关注：客户端自己判断，不用平台的需关注名单（平台加工出来的应用层结果可能有问题）。
 * 依据只用设备产生的数据：按设备来源的昨夜睡眠报告、设备上报的告警。
 * 阈值集中在这里，需要调整时只改这一处。
 */
export const ATTENTION_RULES = {
  /** 睡眠评分低于此值 */
  lowScore: 60,
  /** 夜间睡眠少于此分钟数 */
  shortSleepMinutes: 300,
  /** 夜间离床次数达到此值 */
  frequentLeaveBed: 3,
  /** 呼吸紊乱指数（AHI）达到此值；15 以上为中度 */
  highAhi: 15,
};

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
export function attentionReasons(report: SleepReport | undefined, pending: CareAlert[]): { reasons: string[]; weight: number } {
  const reasons: string[] = [];
  let weight = 0;
  const falls = pending.filter((a) => a.alertTypeName.includes("跌倒"));
  if (falls.length) {
    reasons.push(falls.length > 1 ? `${falls.length} 条跌倒告警未处理` : "跌倒告警未处理");
    weight += 100;
  }
  if (report) {
    const R = ATTENTION_RULES;
    if (report.sleepScore !== undefined && report.sleepScore < R.lowScore) {
      reasons.push(`睡眠评分 ${report.sleepScore} 分`);
      weight += 10 + (R.lowScore - report.sleepScore) / 10;
    }
    const total = report.totalNightSleepMinutes ?? report.totalSleepMinutes;
    if (total !== undefined && total > 0 && total < R.shortSleepMinutes) {
      reasons.push(`睡眠只有 ${minutesText(total)}`);
      weight += 8;
    }
    if ((report.leaveBedCount ?? 0) >= R.frequentLeaveBed) {
      reasons.push(`夜间离床 ${report.leaveBedCount} 次`);
      weight += 6;
    }
    if (report.ahi !== undefined && report.ahi >= R.highAhi) {
      reasons.push(`呼吸紊乱指数 ${report.ahi}`);
      weight += 6;
    }
  }
  return { reasons, weight };
}

/** 全部长者的需关注名单，按严重程度排序 */
export function buildAttention(members: Member[], reports: Map<string, SleepReport> | undefined, pendingAlerts: CareAlert[]) {
  const pendingBy = new Map<string, CareAlert[]>();
  for (const a of pendingAlerts) for (const m of a.members ?? []) pendingBy.set(m.memberId, [...(pendingBy.get(m.memberId) ?? []), a]);
  const items: AttentionItem[] = [];
  for (const m of members) {
    const { reasons, weight } = attentionReasons(reports?.get(m.memberId), pendingBy.get(m.memberId) ?? []);
    if (reasons.length) items.push({ memberId: m.memberId, realName: m.realName, bedName: m.bedName, reasons, weight });
  }
  items.sort((a, b) => b.weight - a.weight);
  return { total: items.length, items };
}
