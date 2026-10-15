/**
 * 解析 SignalR 推送的 DeviceData（与网页端 vendors.sdb 模块 97350 的解析一致）。
 * 推送格式：{ sn, msgType, payload, timestamp, dataType }，payload 多为数组。
 *
 * msgType：
 *  1  呼吸心率   [目标数, 目标距离, 心率, 呼吸率, 体动指数, 呼吸波形, 状态, 呼吸深度]
 *  2  人体存在
 *  3  跌倒检测
 *  4  青岚呼吸心率 [呼吸率, 心率, 呼吸状态, 心率状态, 生命状态, 睡眠状态]
 *     睡眠状态实测（2026-10-15，与睡眠报告分段、白天在床数据对照）：1 浅睡，2 深睡，3 清醒。
 *     白天在床醒着的长者几乎全是 3；夜里 3 对应报告的清醒 / 离床段。不是网页端写的 0 离床 / 3 眼动 / 4 清醒
 *  5  青岚轨迹   [[人数, x, y, z, 姿态, 目标序号, 区域名, 区域序号], ...]
 *  6  超宽带呼吸睡眠 [心率, 呼吸率, 存在状态, 在床时长, 离床时长, 最近距离, 活动状态, 睡眠状态, 生命体征报警]
 *  7  超宽带人体存在
 *  11 在线状态（payload 为 true / false）
 */

export interface DeviceDataMessage {
  sn: string;
  msgType: number;
  payload: unknown;
  timestamp?: number | string;
  dataType?: number;
}

/** 一台设备最近一次上报合并后的实时状态 */
export interface LiveData {
  online?: boolean;
  /** 0 无人，1 有人，2 生命体征信号弱 */
  presence?: number;
  /** 姿态，见 POSTURE */
  posture?: number;
  /** 雷达跟踪到的人数（轨迹上报） */
  targets?: number;
  /**
   * 区域名（房间里划的区域，例如"门""监护床"）。注意不是当前所在位置，而是这个人**最近一次进入的区域**，
   * 换到下一个区域前一直不变（2026-10-15 实测：从门进房后在房间中间走动，仍一直报"门"；区域序号 255 表示还没进过任何区域）。
   * 界面上不要拿它当位置显示
   */
  areaName?: string;
  /** 青岚（msgType 4）：1 浅睡，2 深睡，3 清醒；超宽带（msgType 6）的编码未核对 */
  sleepStatus?: number;
  /** 0 正常，3 生命体征弱 */
  lifeStatus?: number;
  /** 0 正常，1 过低，2 过高，3 暂停 */
  breathStatus?: number;
  heartRate?: number;
  respiratoryRate?: number;
  /** 跌倒检测（msgType 3）上报的值，非 0 视为跌倒 */
  fall?: number;
  inBedMinutes?: number;
  outOfBedMinutes?: number;
  /** 最近一次测到心率或呼吸（大于 0）的时间（毫秒）。人在床上时设备一定测得到心率呼吸，离开后就没有，用它判断在床 */
  vitalsAt?: number;
  /** 最近一次数据的时间（毫秒） */
  updatedAt: number;
}

/** 姿态枚举（网页端 posture 枚举） */
export const POSTURE: Record<number, string> = {
  0: "静止",
  1: "行走",
  2: "疑似跌倒",
  3: "坐",
  4: "静止",
  5: "确认跌倒",
  6: "在床",
  7: "疑似坐地",
  8: "确认坐地",
  9: "床上坐起",
  10: "疑似床上坐起",
  11: "确认床上坐起",
};

/** 人在床上的姿态：在床、床上坐起（含疑似 / 确认） */
export const BED_POSTURES = new Set([6, 9, 10, 11]);

/** 需要立即处理的姿态 */
export const ALARM_POSTURES = new Set([2, 5, 7, 8, 10, 11]);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** 测到心率或呼吸时记下时间（合并进 LiveData；没测到时不覆盖上一次的时间） */
const vitalsSeen = (hr: unknown, rr: unknown, at: number) => ((num(hr) ?? 0) > 0 || (num(rr) ?? 0) > 0 ? { vitalsAt: at } : {});

function ts(t: DeviceDataMessage["timestamp"]) {
  if (typeof t === "number") return t < 1e12 ? t * 1000 : t;
  if (typeof t === "string") {
    const n = Date.parse(t.replace(" ", "T"));
    if (!Number.isNaN(n)) return n;
  }
  return Date.now();
}

/** 把一条 DeviceData 转成要合并进 LiveData 的字段；不认识的 msgType 返回 null */
export function parseDeviceData(m: DeviceDataMessage): Partial<LiveData> | null {
  const p = m.payload;
  const a = Array.isArray(p) ? p : undefined;
  const at = ts(m.timestamp);
  switch (m.msgType) {
    case 1:
      if (!a || a.length < 8) return null;
      return { heartRate: num(a[2]), respiratoryRate: num(a[3]), presence: (num(a[0]) ?? 0) > 0 ? 1 : 0, ...vitalsSeen(a[2], a[3], at), online: true, updatedAt: at };
    case 2:
    case 7:
      return { presence: num(a ? a[0] : p) ?? (p ? 1 : 0), online: true, updatedAt: at };
    case 3:
      return { fall: num(a ? a[0] : p) ?? (p ? 1 : 0), online: true, updatedAt: at };
    case 4:
      if (!a || a.length < 6) return null;
      return {
        respiratoryRate: num(a[0]),
        heartRate: num(a[1]),
        breathStatus: num(a[2]),
        lifeStatus: num(a[4]),
        sleepStatus: num(a[5]),
        ...vitalsSeen(a[1], a[0], at),
        online: true,
        updatedAt: at,
      };
    case 5: {
      if (!a) return null;
      const targets = a.filter(Array.isArray) as unknown[][];
      // 房间里有多人时（例如护理员在床边），优先取在床上的那个人：先看姿态（在床 / 床上坐起），
      // 再看最近进入的区域是监护床（区域名会一直保留到进入下一个区域，所以只作为第二依据）；
      // 没人在床再取需要处理的姿态，最后取第一个目标
      const t =
        targets.find((x) => BED_POSTURES.has(Number(x[4]))) ??
        targets.find((x) => typeof x[6] === "string" && x[6].includes("床")) ??
        targets.find((x) => ALARM_POSTURES.has(Number(x[4]))) ??
        targets[0];
      return {
        presence: targets.length && (num(targets[0][0]) ?? 0) > 0 ? 1 : 0,
        targets: targets.length,
        posture: t ? num(t[4]) : undefined,
        areaName: t && typeof t[6] === "string" ? t[6] : undefined,
        online: true,
        updatedAt: at,
      };
    }
    case 6:
      if (!a || a.length < 9) return null;
      return {
        heartRate: num(a[0]),
        respiratoryRate: num(a[1]),
        presence: num(a[2]),
        inBedMinutes: num(a[3]),
        outOfBedMinutes: num(a[4]),
        sleepStatus: num(a[7]),
        ...vitalsSeen(a[0], a[1], at),
        online: true,
        updatedAt: at,
      };
    case 11:
      return { online: p === true || p === 1 || p === "true", updatedAt: at };
    default:
      return null;
  }
}

/** 超过这个时间没有收到设备的任何数据（实时推送或心跳），就认为设备离线 / 状态未知。两端统一用这个值 */
export const LIVE_STALE_MS = 10 * 60 * 1000;

export interface DeviceLink {
  online: boolean;
  /** device = 根据设备自己上报的数据判断；platform = 没收到设备数据，用的是平台记录（可能有延迟） */
  source: "device" | "platform";
  /** 最近一次收到设备数据的时间（毫秒） */
  at?: number;
}

/**
 * 设备在线状态，以设备自己的数据为准（平台列表里的在线状态和最近活动时间有时延迟很久）：
 * 1. 实时推送报离线（msgType 11 = false），且之后没有再收到心跳 → 离线；
 * 2. 最近 10 分钟内收到过实时数据或心跳 → 在线，超过 → 离线；
 * 3. 一直没收到设备数据，才用平台记录。
 */
export function deviceLink(o: { live?: LiveData; lastReportAt?: number; platformOnline?: boolean; now: number }): DeviceLink {
  const at = Math.max(o.live?.updatedAt ?? 0, o.lastReportAt ?? 0) || undefined;
  if (o.live?.online === false && (o.lastReportAt ?? 0) <= o.live.updatedAt) return { online: false, source: "device", at };
  if (at) return { online: o.now - at <= LIVE_STALE_MS, source: "device", at };
  return { online: !!o.platformOnline, source: "platform" };
}
