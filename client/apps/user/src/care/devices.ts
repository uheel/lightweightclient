import { ALARM_POSTURES, LIVE_STALE_MS, type LiveData } from "@radar/core";

/**
 * 一位长者常绑着几台设备：卧室一台看床（床位监护 / 呼吸睡眠），卫生间一台看跌倒，型号也常常不一样。
 * 各台设备各报各的，不能简单地"后到的覆盖先到的"（卫生间那台每秒报一次"没人"，会把卧室的"在床"盖掉），
 * 这里先判断人现在在哪台设备那边，状态就取那台的；心率呼吸、睡眠取能测体征的那台。
 */

export interface DeviceLike {
  sn: string;
  deviceType?: number;
  qlWorkingType?: number;
  rangeName?: string;
  sortOrder?: number;
}

/** 越小越像看床的设备：床位监护 / 呼吸睡眠模式、Ultra 呼吸睡眠排前面，跌倒监测（UltraFall、跌倒模式）排最后 */
export function bedScore(d: { deviceType?: number; qlWorkingType?: number }) {
  if (d.qlWorkingType === 15 || d.qlWorkingType === 11 || d.deviceType === 12) return 0;
  if (d.qlWorkingType === 7 || d.deviceType === 13) return 2;
  return 1;
}

export const byBed = <T extends { deviceType?: number; qlWorkingType?: number; sortOrder?: number }>(list: T[]) =>
  [...list].sort((a, b) => bedScore(a) - bedScore(b) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

/**
 * 装在床以外地方的设备（卫生间等）：和看床那台的安装区域不一样的。
 * 只有一台设备，或者几台都没写区域 / 区域一样（一个房间两张床各一台）时为空
 */
export function awayDevices(devices: DeviceLike[] | undefined) {
  const list = devices ?? [];
  if (list.length < 2) return { sns: new Set<string>(), names: [] as string[] };
  const home = byBed(list)[0]!.rangeName;
  const away = list.filter((d) => d.rangeName && d.rangeName !== home);
  return { sns: new Set(away.map((d) => d.sn)), names: [...new Set(away.map((d) => d.rangeName!))] };
}

export interface MemberLive extends LiveData {
  /** 人现在在哪（那台设备的安装区域，例如"卫生间"）；只有一台设备、或几台装在同一处时没有 */
  where?: string;
}

/** 最近 1 分钟内测到心率或呼吸就算在床（与 careState 一致） */
const IN_BED_MS = 60_000;
/** 告警姿态要是这么久内看到的，才算人还在那里（人走开后那台设备最后一帧会一直留着） */
const ALARM_HOLD_MS = 60_000;

const hasVitals = (l: LiveData) => l.vitalsAt !== undefined || l.sleepStatus !== undefined || l.breathStatus !== undefined;

/** 把一位长者几台设备的实时数据合成一份 */
export function mergeLive(devices: DeviceLike[] | undefined, liveBySn: Record<string, LiveData>, now: number): MemberLive | undefined {
  const list = (devices ?? []).flatMap((d) => (liveBySn[d.sn] ? [{ d, l: liveBySn[d.sn]! }] : []));
  if (!list.length) return undefined;
  // 只有一台设备有数据：原样用
  if (list.length === 1) return list[0]!.l;

  const t = (l: LiveData) => Math.max(now, l.updatedAt);
  const fresh = list.filter(({ l }) => t(l) - l.updatedAt <= LIVE_STALE_MS && l.online !== false);
  const updatedAt = Math.max(...list.map(({ l }) => l.updatedAt));
  const online = fresh.length ? true : list.some(({ l }) => l.online === false) ? false : undefined;
  const base: MemberLive = { updatedAt, online };
  if (!fresh.length) return base;

  // 体征：取最近测到心率呼吸的那台；都没测到时取看床的那台（离床时长、睡眠状态还在它那里）
  const withVitals = fresh.filter(({ l }) => hasVitals(l));
  const measured = withVitals.filter(({ l }) => l.vitalsAt !== undefined).sort((a, b) => b.l.vitalsAt! - a.l.vitalsAt!);
  const vitalsOf = measured[0] ?? [...withVitals].sort((a, b) => bedScore(a.d) - bedScore(b.d))[0];
  if (vitalsOf) {
    const l = vitalsOf.l;
    Object.assign(base, {
      heartRate: l.heartRate,
      respiratoryRate: l.respiratoryRate,
      breathStatus: l.breathStatus,
      lifeStatus: l.lifeStatus,
      sleepStatus: l.sleepStatus,
      vitalsAt: l.vitalsAt,
      inBedMinutes: l.inBedMinutes,
      outOfBedMinutes: l.outOfBedMinutes,
    });
  }

  // 人在哪：1 有设备刚看到需要处理的姿态 → 那里；2 在床（测得到心率呼吸）→ 看床那台；3 最近报"有人"的那台
  const present = fresh.filter(({ l }) => l.presence !== 0 && l.seenAt !== undefined);
  const alarm = present
    .filter(({ l }) => (l.fall || (l.posture !== undefined && ALARM_POSTURES.has(l.posture))) && t(l) - (l.seenAt ?? 0) <= ALARM_HOLD_MS)
    .sort((a, b) => (b.l.seenAt ?? 0) - (a.l.seenAt ?? 0))[0];
  const inBed = vitalsOf && vitalsOf.l.vitalsAt !== undefined && t(vitalsOf.l) - vitalsOf.l.vitalsAt <= IN_BED_MS ? vitalsOf : undefined;
  const at = alarm ?? inBed ?? [...present].sort((a, b) => (b.l.seenAt ?? 0) - (a.l.seenAt ?? 0))[0];
  if (at) {
    Object.assign(base, { presence: at.l.presence ?? 1, posture: at.l.posture, targets: at.l.targets, areaName: at.l.areaName, fall: at.l.fall, seenAt: at.l.seenAt });
    // 几台设备装在不同地方时才写在哪
    const names = new Set(list.map(({ d }) => d.rangeName).filter(Boolean));
    if (names.size > 1 && at.d.rangeName) base.where = at.d.rangeName;
  } else if (fresh.some(({ l }) => l.presence === 0)) base.presence = 0;
  return base;
}
