import { useCallback, useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { api } from "@radar/core";
import { getRadars } from "../api/device";
import { getAllBeds, getMembers } from "../api/member";

/**
 * 数据魔墙 · 运营展示墙的取数（口径见 docs/data-wall.md 第 3 节）。
 * 平台只取原始记录：长者、床位、雷达、告警、按设备来源的睡眠报告。所有统计在 stats.ts 里算。
 * 告警每次打开 / 每 10 分钟整段重取（已结束的天里告警也会被补处理，缓存会过时）；
 * 睡眠报告是一人一晚一份，已结束的夜晚存本机，之后不再取。
 */

/** 最多看多少天（"本月"最多 31 天） */
export const WINDOW_DAYS = 31;
/** 整墙重取的间隔 */
export const REFRESH_MS = 10 * 60_000;
const FMT = "YYYY-MM-DD HH:mm:ss";
/** 需要人去处理的告警分组：1 场景，2 事件，4 紧急求助（离线、安装姿态不算） */
const CARE_GROUPS = [1, 2, 4];

export interface WallAlert {
  id: string;
  typeName: string;
  group: number;
  /** 1 未处理，2 已处理 */
  status: number;
  createdAt: number;
  processAt?: number;
  processTypeName?: string;
}

export interface WallMember {
  id: string;
  age?: number;
  /** 看床的设备对应的睡眠报告来源（按优先顺序），空 = 没有能出睡眠报告的设备 */
  sources: number[];
}

/** 一人一晚的睡眠报告里用到的字段（存本机，越小越好） */
export interface NightReport {
  /** 评分 */
  s?: number;
  /** 睡着的分钟数 */
  t?: number;
  /** 离床次数 */
  l?: number;
}

export interface WallData {
  members: WallMember[];
  beds: { total: number; occupied: number };
  radars: { total: number; online: number };
  alerts: WallAlert[];
  /** 告警取数范围的起点（毫秒） */
  since: number;
  /** "memberId|YYYY-MM-DD"（报告日期 = 醒来那天）→ 报告，null = 那晚没有报告 */
  nights: Map<string, NightReport | null>;
  loadedAt: number;
}

const ts = (s?: string) => (s ? dayjs(s).valueOf() : undefined);

interface RawAlert {
  id: string;
  alertTypeName: string;
  alertStatus: number;
  createdAt: string;
  processAt?: string;
  alertProcessTypeName?: string;
}

async function getCareAlerts(since: number) {
  const range = `${dayjs(since).format(FMT)},${dayjs().endOf("day").format(FMT)}`;
  const lists = await Promise.all(
    CARE_GROUPS.map(async (group) => {
      const r = await api.getAll<RawAlert>("/api/alert/pages", { pageSize: 1000, max: 50_000, filter: { alertTypeGroup: group, createdAt: range } });
      return (r.data ?? []).map(
        (a): WallAlert => ({
          id: a.id,
          typeName: a.alertTypeName,
          group,
          status: a.alertStatus,
          createdAt: ts(a.createdAt)!,
          processAt: a.alertStatus === 2 ? ts(a.processAt) : undefined,
          processTypeName: a.alertProcessTypeName,
        }),
      );
    }),
  );
  return lists.flat();
}

// ---------- 睡眠报告来源（与用户端 care/health.ts 的 sourcesOf 同一规则） ----------

/** 设备类型 → 睡眠报告来源：6 AIO → 1，12 Ultra → 3，13 UltraFall → 5，15 Ultra Plus → 6 */
const SOURCE_BY_DEVICE_TYPE: Record<number, number> = { 6: 1, 12: 3, 13: 5, 15: 6 };
const RADAR_SOURCES = new Set([1, 3, 5, 6]);

interface PanoramicMember {
  memberId: string;
  devices?: { deviceType?: number; qlWorkingType?: number; sortOrder?: number }[];
}

/** 越小越像看床的设备（同用户端 care/devices.ts 的 bedScore） */
function bedScore(d: { deviceType?: number; qlWorkingType?: number }) {
  if (d.qlWorkingType === 15 || d.qlWorkingType === 11 || d.deviceType === 12) return 0;
  if (d.qlWorkingType === 7 || d.deviceType === 13) return 2;
  return 1;
}

function sourcesOf(devices: PanoramicMember["devices"] = []) {
  const sorted = [...devices].sort((a, b) => bedScore(a) - bedScore(b) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return [...new Set(sorted.flatMap((d) => (d.deviceType !== undefined && SOURCE_BY_DEVICE_TYPE[d.deviceType] ? [SOURCE_BY_DEVICE_TYPE[d.deviceType]] : [])))];
}

async function getWallMembers(): Promise<WallMember[]> {
  const [rows, pano] = await Promise.all([
    getMembers(),
    api.get<PanoramicMember[]>("/api/room/member-panoramic", { params: { pageSize: 1000, pageIndex: 0 } }).then((r) => r.data ?? []),
  ]);
  const devices = new Map(pano.map((m) => [m.memberId, m.devices]));
  // 在住 = 已入住（checkType 2）；长者档案里还有亲友、已退住的记录
  return rows.filter((m) => m.checkType === 2).map((m) => ({ id: m.id, age: m.age || undefined, sources: sourcesOf(devices.get(m.id)) }));
}

interface RawSleepReport {
  sleepScore?: number;
  sleepSummary?: { totalSleepMinutes?: number };
  metrics?: { leaveBedCount?: number };
  sleepDetails?: unknown[];
}

/** 一人一晚：按来源依次查，取第一份有数据的。平台第一次被请求时才生成报告，可能要几十秒，不设超时 */
async function getNight(m: WallMember, date: string): Promise<NightReport | null> {
  for (const source of m.sources) {
    const r = await api.get<RawSleepReport | null>("/api/health/sleep-report", {
      params: { memberId: m.id, date, source, windowMinutes: RADAR_SOURCES.has(source) ? 1 : undefined },
    });
    const d = r.data;
    if (d && (d.sleepDetails?.length || d.sleepSummary?.totalSleepMinutes)) {
      return { s: d.sleepScore || undefined, t: d.sleepSummary?.totalSleepMinutes, l: d.metrics?.leaveBedCount };
    }
  }
  return null;
}

// ---------- 本机缓存（每个机构一份） ----------

const nightsKey = (orgId: string) => `ops.dataWall.nights.${orgId}`;

function loadNights(orgId: string) {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(nightsKey(orgId)) ?? "{}") as Record<string, NightReport | null>));
  } catch {
    return new Map<string, NightReport | null>();
  }
}

function saveNights(orgId: string, nights: Map<string, NightReport | null>, oldest: string) {
  // 只留窗口内的，旧的丢掉
  const keep = Object.fromEntries([...nights].filter(([k]) => k.slice(-10) >= oldest));
  try {
    localStorage.setItem(nightsKey(orgId), JSON.stringify(keep));
  } catch {
    /* 存不下就下次再取 */
  }
}

/** 报告日期为 date 的那晚已经结束、报告不会再变（早上 10 点以后） */
const nightEnded = (date: string, now: number) => now >= dayjs(date).hour(10).valueOf();

/** 窗口内的报告日期，新的在前（今天早上醒来的那晚也算） */
export function nightDates(now: number) {
  return Array.from({ length: WINDOW_DAYS }, (_, i) => dayjs(now).subtract(i, "day").format("YYYY-MM-DD"));
}

export interface WallState {
  data?: WallData;
  error?: string;
  loading: boolean;
  /** 睡眠报告补取进度：已有 / 应有（人 × 晚） */
  sleep: { done: number; total: number };
  refresh: () => void;
}

/** 并发补取睡眠报告的数量 */
const SLEEP_CONCURRENCY = 4;

/**
 * 运营墙的数据：打开时取长者、床位、雷达、近 31 天告警，之后每 10 分钟重取；
 * 睡眠报告在后台从最近一晚往前补，取到的已结束夜晚存本机。
 */
export function useWallData(orgId: string): WallState {
  const [data, setData] = useState<WallData>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [sleep, setSleep] = useState({ done: 0, total: 0 });
  const nights = useRef(loadNights(orgId));
  const run = useRef(0);

  const load = useCallback(async () => {
    const id = ++run.current;
    setLoading(true);
    setError(undefined);
    try {
      const now = Date.now();
      const since = dayjs(now).subtract(WINDOW_DAYS - 1, "day").startOf("day").valueOf();
      const [members, bedList, radarList, alerts] = await Promise.all([getWallMembers(), getAllBeds(), getRadars(), getCareAlerts(since)]);
      if (id !== run.current) return;
      const base: WallData = {
        members,
        beds: { total: bedList.length, occupied: bedList.filter((b) => b.memberId).length },
        radars: { total: radarList.length, online: radarList.filter((r) => r.isOnline).length },
        alerts,
        since,
        nights: new Map(nights.current),
        loadedAt: now,
      };
      setData(base);
      setLoading(false);

      // 睡眠报告：最近一晚往前，缺的才取
      const dates = nightDates(now);
      const withSource = members.filter((m) => m.sources.length);
      const todo = dates.flatMap((date) => withSource.flatMap((m) => (nights.current.has(`${m.id}|${date}`) && nightEnded(date, now) ? [] : [{ m, date }])));
      const total = withSource.length * dates.length;
      setSleep({ done: total - todo.length, total });
      let i = 0;
      let done = total - todo.length;
      let dirty = 0;
      const flush = () => {
        saveNights(orgId, nights.current, dates[dates.length - 1]);
        setData((d) => (d ? { ...d, nights: new Map(nights.current) } : d));
        setSleep({ done, total });
        dirty = 0;
      };
      await Promise.all(
        Array.from({ length: SLEEP_CONCURRENCY }, async () => {
          while (i < todo.length && id === run.current) {
            const { m, date } = todo[i++];
            const r = await getNight(m, date).catch(() => undefined);
            if (id !== run.current) return;
            // 取失败的不记，下次再试；还没结束的夜晚也记下，但下次打开会重取
            if (r !== undefined) nights.current.set(`${m.id}|${date}`, r);
            done++;
            if (++dirty >= 20) flush();
          }
        }),
      );
      if (id === run.current) flush();
    } catch (e) {
      if (id !== run.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(t);
      run.current++;
    };
  }, [load]);

  return { data, error, loading, sleep, refresh: load };
}
