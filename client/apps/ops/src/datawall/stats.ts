import dayjs from "dayjs";
import type { NightReport, WallAlert, WallData } from "./data";

/** 运营展示墙的统计（全部在客户端算，口径见 docs/data-wall.md 第 3 节） */

export type RangeKey = "7" | "30" | "month";
export const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7", label: "近 7 天" },
  { key: "30", label: "近 30 天" },
  { key: "month", label: "本月" },
];

/** 及时处理的阈值（分钟），同用户端"需关注规则"的 timelyMinutes 默认值 */
export const TIMELY_MINUTES = 5;
/** 算"连续安全天数"的告警：跌倒、坐地类 */
const FALL_RE = /跌倒|坐地/;
/** 处理类型名里带这个的算误报（处理类型由各机构自定义） */
const FALSE_RE = /误报/;

export const SCORE_BANDS = [
  { label: "良好", min: 80 },
  { label: "一般", min: 70 },
  { label: "偏低", min: 60 },
  { label: "需关注", min: -Infinity },
];

export const LAG_BUCKETS = [
  { label: "5 分钟内", max: 5 },
  { label: "5–30 分钟", max: 30 },
  { label: "30 分钟–2 小时", max: 120 },
  { label: "2–12 小时", max: 720 },
  { label: "12 小时以上", max: Infinity },
];

export const AGE_BUCKETS = [
  { label: "60 岁以下", max: 59 },
  { label: "60–69", max: 69 },
  { label: "70–79", max: 79 },
  { label: "80–89", max: 89 },
  { label: "90 岁以上", max: Infinity },
];

const DAY_MS = 86_400_000;

/** 范围内的日期（旧 → 新） */
export function rangeDays(key: RangeKey, now: number) {
  const n = key === "7" ? 7 : key === "30" ? 30 : dayjs(now).date();
  return Array.from({ length: n }, (_, i) => dayjs(now).subtract(n - 1 - i, "day").format("YYYY-MM-DD"));
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const lagOf = (a: WallAlert) => (a.processAt !== undefined ? Math.max(0, (a.processAt - a.createdAt) / 60_000) : undefined);
const timely = (a: WallAlert) => {
  const l = lagOf(a);
  return l !== undefined && l <= TIMELY_MINUTES;
};

/** 名字 → 数量，多的在前；超过 top 个的合成"其他" */
function countBy<T>(xs: T[], key: (x: T) => string, top: number) {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  const all = [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (all.length <= top) return all;
  const rest = all.slice(top - 1);
  return [...all.slice(0, top - 1), { label: `其他 ${rest.length} 类`, value: rest.reduce((s, x) => s + x.value, 0) }];
}

export interface Bucketed {
  label: string;
  /** 这一段包含的日期 */
  days: string[];
}

/** 睡眠图的横轴：7 天以内按天，更长按周（从最近一天往前每 7 天一段） */
function sleepBuckets(days: string[]): Bucketed[] {
  if (days.length <= 7) return days.map((d) => ({ label: dayjs(d).format("M/D"), days: [d] }));
  const out: Bucketed[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const part = days.slice(Math.max(0, end - 7), end);
    out.unshift({ label: `${dayjs(part[0]).format("M/D")}–${dayjs(part[part.length - 1]).format("M/D")}`, days: part });
  }
  return out;
}

export function computeStats(d: WallData, key: RangeKey, now: number) {
  const days = rangeDays(key, now);
  const start = dayjs(days[0]).valueOf();
  const alerts = d.alerts.filter((a) => a.createdAt >= start);
  const dayOf = (t: number) => dayjs(t).format("YYYY-MM-DD");

  // ---- 告警 ----
  const perDay = new Map(days.map((x) => [x, [] as WallAlert[]]));
  for (const a of alerts) perDay.get(dayOf(a.createdAt))?.push(a);
  const processed = alerts.filter((a) => a.processAt !== undefined);
  const lags = processed.map((a) => lagOf(a)!);
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const a of alerts) {
    const t = dayjs(a.createdAt);
    heat[(t.day() + 6) % 7][t.hour()]++;
  }
  const lagBuckets = LAG_BUCKETS.map((b, i) => ({
    label: b.label,
    value: lags.filter((l) => l <= b.max && (i === 0 || l > LAG_BUCKETS[i - 1].max)).length,
  }));
  lagBuckets.push({ label: "未处理", value: alerts.length - processed.length });

  // 连续安全天数：距最近一次"跌倒 / 坐地告警没在 5 分钟内处理"的天数（只看已取的窗口）
  const misses = d.alerts.filter((a) => FALL_RE.test(a.typeName) && !timely(a) && now - a.createdAt > TIMELY_MINUTES * 60_000);
  const lastMiss = misses.length ? Math.max(...misses.map((a) => a.createdAt)) : undefined;
  const safeDays =
    lastMiss !== undefined
      ? { value: Math.floor((dayjs(now).startOf("day").valueOf() - dayjs(lastMiss).startOf("day").valueOf()) / DAY_MS), atLeast: false }
      : { value: Math.round((dayjs(now).startOf("day").valueOf() - d.since) / DAY_MS), atLeast: true };

  // ---- 长者 ----
  const ages = d.members.flatMap((m) => (m.age ? [m.age] : []));
  const ageBuckets = AGE_BUCKETS.map((b, i) => ({ label: b.label, value: ages.filter((a) => a <= b.max && (i === 0 || a > AGE_BUCKETS[i - 1].max)).length }));

  // ---- 睡眠：报告日期在范围内的夜晚 ----
  const sleepers = d.members.filter((m) => m.sources.length);
  const reportsOn = (day: string) => sleepers.flatMap((m) => {
    const r = d.nights.get(`${m.id}|${day}`);
    return r ? [r] : [];
  });
  /** 范围内已经取过（不管有没有报告）的人晚数，用来说明睡眠数据补到哪了 */
  const fetchedNights = days.reduce((s, day) => s + sleepers.filter((m) => d.nights.has(`${m.id}|${day}`)).length, 0);
  const sleepDays = days.map((day) => ({ day, reports: reportsOn(day) }));
  const allReports = sleepDays.flatMap((x) => x.reports);
  const scored = (rs: NightReport[]) => rs.flatMap((r) => (r.s ? [r.s] : []));
  const band = (s: number) => SCORE_BANDS.findIndex((b) => s >= b.min);
  const sleepBucketed = sleepBuckets(days).map((b) => {
    const rs = b.days.flatMap((day) => reportsOn(day));
    const counts = SCORE_BANDS.map(() => 0);
    for (const s of scored(rs)) counts[band(s)]++;
    return { label: b.label, counts };
  });
  const nightsWithData = sleepDays.filter((x) => x.reports.length);

  return {
    days,
    alerts: {
      total: alerts.length,
      perDay: days.map((x) => perDay.get(x)!.length),
      types: countBy(alerts, (a) => a.typeName, 6),
      lagMedian: median(lags),
      lagPerDay: days.map((x) => median(perDay.get(x)!.flatMap((a) => (a.processAt !== undefined ? [lagOf(a)!] : [])))),
      timelyRate: alerts.length ? alerts.filter(timely).length / alerts.length : undefined,
      lagBuckets,
      heat,
      processTypes: countBy(processed, (a) => a.processTypeName || "未填写", 5),
      falseRate: processed.length ? processed.filter((a) => FALSE_RE.test(a.processTypeName ?? "")).length / processed.length : undefined,
      /** 窗口内（近 31 天）还没处理的 */
      pending: d.alerts.filter((a) => a.status === 1).length,
    },
    safeDays,
    members: {
      total: d.members.length,
      ageBuckets,
      ageUnknown: d.members.length - ages.length,
      sleepers: sleepers.length,
    },
    beds: d.beds,
    radars: d.radars,
    sleep: {
      avgScore: mean(scored(allReports)),
      avgSleepMinutes: mean(allReports.flatMap((r) => (r.t ? [r.t] : []))),
      avgLeaveBed: mean(allReports.flatMap((r) => (r.l !== undefined ? [r.l] : []))),
      /** 有报告的夜晚里，平均每晚有报告的人数 / 有睡眠设备的人数 */
      coverage: nightsWithData.length && sleepers.length ? mean(nightsWithData.map((x) => x.reports.length))! / sleepers.length : undefined,
      perDayMinutes: sleepDays.map((x) => mean(x.reports.flatMap((r) => (r.t ? [r.t] : [])))),
      perDayLeave: sleepDays.map((x) => mean(x.reports.flatMap((r) => (r.l !== undefined ? [r.l] : [])))),
      bands: sleepBucketed,
      /** 范围内已取的人晚数 / 应有的人晚数 */
      fetched: fetchedNights,
      expected: days.length * sleepers.length,
      /** 范围内最早有报告的那天 */
      firstDay: nightsWithData[0]?.day,
    },
  };
}

export type WallStats = ReturnType<typeof computeStats>;
