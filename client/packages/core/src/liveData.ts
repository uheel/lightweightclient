/**
 * 解析 SignalR 推送的 DeviceData（与网页端 vendors.sdb 模块 97350 的解析一致）。
 * 推送格式：{ sn, msgType, payload, timestamp, dataType }，payload 多为数组。
 *
 * msgType：
 *  1  呼吸心率   [目标数, 目标距离, 心率, 呼吸率, 体动指数, 呼吸波形, 状态, 呼吸深度]
 *  2  人体存在
 *  3  跌倒检测
 *  4  青岚呼吸心率 [呼吸率, 心率, 呼吸状态, 心率状态, 生命状态, 睡眠状态]
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
  /** 所在区域名（房间里划的区域，例如"卫生间""监护床"） */
  areaName?: string;
  /** 0 离床 / 未定义，1 浅睡，2 深睡，3 眼动，4 清醒 */
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

/** 需要立即处理的姿态 */
export const ALARM_POSTURES = new Set([2, 5, 7, 8, 10, 11]);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

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
      return { heartRate: num(a[2]), respiratoryRate: num(a[3]), presence: (num(a[0]) ?? 0) > 0 ? 1 : 0, online: true, updatedAt: at };
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
        online: true,
        updatedAt: at,
      };
    case 5: {
      if (!a) return null;
      const targets = a.filter(Array.isArray) as unknown[][];
      // 有多个目标时，优先取需要处理的姿态
      const sorted = [...targets].sort((x, y) => Number(ALARM_POSTURES.has(Number(y[4]))) - Number(ALARM_POSTURES.has(Number(x[4]))));
      const t = sorted[0];
      return {
        presence: targets.length && (num(targets[0][0]) ?? 0) > 0 ? 1 : 0,
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
        online: true,
        updatedAt: at,
      };
    case 11:
      return { online: p === true || p === 1 || p === "true", updatedAt: at };
    default:
      return null;
  }
}
