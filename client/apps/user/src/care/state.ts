import { ALARM_POSTURES, POSTURE, type LiveData } from "@radar/core";
import type { CareAlert, Member } from "./api";

/**
 * 把设备的实时数据翻译成护理人员看得懂的一句话状态。
 * 用户端不出现"设备 / 离线 / SN"这类词：设备离线说成"暂停监测"。
 */
export type CareTone = "alert" | "warn" | "bed" | "active" | "idle" | "unknown";

export interface CareState {
  text: string;
  tone: CareTone;
  /** 次要说明，例如区域、"已持续 12 分钟" */
  detail?: string;
}

/** 超过这个时间没有任何数据，就认为状态未知 */
const STALE_MS = 10 * 60 * 1000;

export function careState(member: Member, live: LiveData | undefined, alert: CareAlert | undefined, now: number): CareState {
  if (alert) return { text: alert.alertTypeName, tone: "alert", detail: sinceText(alert.createdAt, now) };

  const anyOnline = member.devices?.some((d) => d.isOnline);
  if (!live || now - live.updatedAt > STALE_MS) {
    if (live?.online === false || (!live && member.devices?.length && !anyOnline)) {
      return { text: "暂停监测", tone: "unknown", detail: "暂时收不到这位长者的数据" };
    }
    return { text: "等待数据", tone: "unknown" };
  }
  if (live.online === false) return { text: "暂停监测", tone: "unknown", detail: "暂时收不到这位长者的数据" };

  const area = live.areaName ? live.areaName : undefined;
  if (live.posture !== undefined && ALARM_POSTURES.has(live.posture)) {
    return { text: POSTURE[live.posture], tone: "alert", detail: area };
  }
  if (live.fall) return { text: "疑似跌倒", tone: "alert", detail: area };
  if (live.lifeStatus === 3) return { text: "生命体征弱", tone: "warn", detail: "请留意" };
  if (live.breathStatus === 3) return { text: "呼吸暂停", tone: "alert" };

  // 睡眠状态（床垫类监测）：0 离床，1 浅睡，2 深睡，3 眼动，4 清醒
  if (live.sleepStatus !== undefined) {
    if (live.sleepStatus === 1 || live.sleepStatus === 2 || live.sleepStatus === 3) {
      return { text: "在床睡觉", tone: "bed", detail: live.sleepStatus === 2 ? "深睡" : "浅睡" };
    }
    if (live.sleepStatus === 4) return { text: "在床休息", tone: "bed", detail: "醒着" };
    if (live.sleepStatus === 0) {
      const m = live.outOfBedMinutes;
      if (m !== undefined && m >= 15) return { text: "离床", tone: "warn", detail: `已 ${durationText(m)}` };
      return { text: "离床", tone: "idle", detail: m ? `已 ${durationText(m)}` : undefined };
    }
  }

  if (live.posture !== undefined) {
    const p = live.posture;
    if (p === 6 || p === 9) return { text: p === 9 ? "在床上坐着" : "在床", tone: "bed", detail: area };
    if (p === 1) return { text: "走动中", tone: "active", detail: area };
    if (p === 3) return { text: "坐着", tone: "active", detail: area };
    return { text: "房间内静止", tone: "active", detail: area };
  }

  if (live.presence === 0) return { text: "不在房间", tone: "idle" };
  if (live.presence === 2) return { text: "信号弱", tone: "warn", detail: "请留意" };
  if (live.presence === 1) return { text: "在房间", tone: "active", detail: area };
  return { text: "等待数据", tone: "unknown" };
}

export function durationText(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

export function sinceText(time: string, now: number) {
  const t = Date.parse(time.replace(" ", "T"));
  if (Number.isNaN(t)) return time;
  const min = Math.max(0, (now - t) / 60000);
  if (min < 1) return "刚刚";
  if (min < 60 * 24) return `${durationText(min)}前`;
  return time.slice(5, 16);
}

export const TONE_STYLE: Record<CareTone, { color: string; bg: string; border: string }> = {
  alert: { color: "#B4232A", bg: "#FDECEC", border: "#F3B5B8" },
  warn: { color: "#9A5B00", bg: "#FFF4E0", border: "#F0D29A" },
  bed: { color: "#3B4FD8", bg: "#EEF1FF", border: "#E8EAF2" },
  active: { color: "#17794A", bg: "#E8F6EE", border: "#E8EAF2" },
  idle: { color: "#5B6078", bg: "#F1F2F7", border: "#E8EAF2" },
  unknown: { color: "#8A8FA8", bg: "#F6F7FB", border: "#E8EAF2" },
};

export function alertLocation(a: CareAlert) {
  return [a.buildingName, a.floorName, a.roomName].filter(Boolean).join(" · ");
}

/** 告警的一句话描述：谁 · 在哪 */
export function alertWhere(a: CareAlert) {
  const who = a.members?.map((m) => m.realName).join("、");
  return [who, alertLocation(a)].filter(Boolean).join(" · ") || "位置未配置";
}
