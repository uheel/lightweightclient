import dayjs from "dayjs";
import { api } from "@radar/core";
import { getRadars } from "../api/device";
import { getSegmentMembers, type GaitSegment } from "../api/gait";
import { getRooms } from "../api/room";

/**
 * 魔墙里要指定房间、长者、日期的平台页面，打开前由客户端挑（平台的默认值不可靠：
 * 报告页默认取 /api/member-report/default-info 的长者，来源是 AIO，藕塘社区大多是 UltraFall，直接显示"报告生成失败"）。
 */
export interface PlatformTarget {
  path: string;
  /**
   * 报告页的地址不能指定日期，不带参数时按 /api/member-report/default-info 的返回打开。
   * 有这一项时，页面脚本把那个接口的返回换成它，就能打开指定长者、类型和日期（见 pages.ts 的 platformScript）
   */
  report?: { memberId: string; type: number; analysisDay: string };
}

const naturally = (a?: string, b?: string) => (a ?? "").localeCompare(b ?? "", "zh-CN", { numeric: true });

/** 第一个绑了雷达的房间：楼栋、楼层（低层在前）、房间 */
export async function firstRoomTarget(): Promise<PlatformTarget | undefined> {
  const [rooms, radars] = await Promise.all([getRooms(), getRadars()]);
  const bound = new Set(radars.map((d) => d.roomId));
  const room = rooms
    .filter((r) => bound.has(r.id))
    .sort(
      (a, b) =>
        (a.buildingSortOrder ?? 0) - (b.buildingSortOrder ?? 0) ||
        naturally(a.buildingName, b.buildingName) ||
        (a.floorNumber ?? 0) - (b.floorNumber ?? 0) ||
        naturally(a.roomName, b.roomName),
    )[0];
  return room && { path: `/care/monitoring/room-view?roomId=${room.id}` };
}

interface PanoramicMember {
  memberId: string;
  devices?: { sn: string; deviceType?: number; qlWorkingType?: number; sortOrder?: number }[];
}

/** 报告类型（member-report/date）：1 睡眠，3 安全守护，5 健康画像；2 平台会报错 */
const SLEEP_REPORT = 1;
const SAFETY_REPORT = 3;
/** 设备类型 → 睡眠报告来源（同用户端 care/health.ts） */
const SOURCE_BY_DEVICE_TYPE: Record<number, number> = { 6: 1, 12: 3, 13: 5, 15: 6 };
const AIO_SOURCE = 1;
/** member-report/date 的值：1 有报告，2 没有数据（2026-11-01 藕塘社区 6 位长者 24 份报告核对：值为 2 的段数、评分都是 0） */
const HAS_REPORT = 1;
/** 最多看这么多位长者，够找到有数据的了，不用把全机构问一遍 */
const MAX_MEMBERS = 12;

/** 越小越像看床的设备（同 model.ts 的 bedScore） */
function bedScore(d: { deviceType?: number; qlWorkingType?: number }) {
  if (d.qlWorkingType === 15 || d.qlWorkingType === 11 || d.deviceType === 12) return 0;
  if (d.qlWorkingType === 7 || d.deviceType === 13) return 2;
  return 1;
}

const getMembers = async () => (await api.get<PanoramicMember[]>("/api/room/member-panoramic", { params: { pageSize: MAX_MEMBERS, pageIndex: 0 } })).data ?? [];

/** 往前查几个月（平台按日历页返回，含前后几天） */
const LOOK_BACK_MONTHS = 3;

/** 这位长者最近有报告的一天 */
async function latestDay(memberId: string, reportType: number, reportSource?: number) {
  const today = dayjs().format("YYYY-MM-DD");
  for (let i = 0; i < LOOK_BACK_MONTHS; i++) {
    const month = dayjs().subtract(i, "month");
    const res = await api.get<Record<string, number>>("/api/member-report/date", { params: { reportType, memberId, date: month.format("YYYY-MM"), reportSource } });
    const days = Object.entries(res.data ?? {})
      .filter(([d, v]) => v === HAS_REPORT && d <= today)
      .map(([d]) => d)
      .sort();
    if (days.length) return days[days.length - 1];
  }
  return undefined;
}

/** 依次问长者，取有报告的日期最新的那位 */
async function newestReport<T>(members: PanoramicMember[], ask: (m: PanoramicMember) => Promise<{ day: string; value: T } | undefined>) {
  let best: { day: string; value: T } | undefined;
  for (const m of members) {
    const r = await ask(m).catch(() => undefined);
    if (r && (!best || r.day > best.day)) best = r;
    // 已经是今天的了，不会有更新的
    if (best?.day === dayjs().format("YYYY-MM-DD")) break;
  }
  return best;
}

/** 平台默认显示的长者：可能已退住，不在实时监护的长者列表里（展厅演示就是这样） */
const platformDefaultMember = async () => (await api.get<{ memberId?: string }>("/api/member-report/default-info")).data?.memberId;

const reportTarget = (memberId: string, type: number, analysisDay: string): PlatformTarget => ({ path: "/care/health/member-health-report", report: { memberId, type, analysisDay } });

/** 睡眠报告：平台的纯净路由，按设备 SN + 日期显示，不带菜单 */
export async function sleepReportTarget(): Promise<PlatformTarget | undefined> {
  const best = await newestReport(await getMembers(), async (m) => {
    const device = [...(m.devices ?? [])]
      .filter((d) => d.deviceType !== undefined && SOURCE_BY_DEVICE_TYPE[d.deviceType])
      .sort((a, b) => bedScore(a) - bedScore(b) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
    if (!device) return undefined;
    const day = await latestDay(m.memberId, SLEEP_REPORT, SOURCE_BY_DEVICE_TYPE[device.deviceType!]);
    return day ? { day, value: device.sn } : undefined;
  });
  if (best) return { path: `/health/sleep-report-device?sn=${encodeURIComponent(best.value)}&date=${best.day}` };
  // 在住长者都没有：退到平台默认的那位（可能已退住，不在长者列表里，也就不知道设备）。报告页默认显示 AIO，所以只查 AIO 来源
  const member = await platformDefaultMember();
  const day = member && (await latestDay(member, SLEEP_REPORT, AIO_SOURCE));
  return day ? reportTarget(member!, SLEEP_REPORT, day) : undefined;
}

/** 安全守护报告：在住长者里日期最新的那位；都没有时退到平台默认的那位 */
export async function safetyReportTarget(): Promise<PlatformTarget | undefined> {
  const best = await newestReport(await getMembers(), async (m) => {
    const day = await latestDay(m.memberId, SAFETY_REPORT);
    return day ? { day, value: m.memberId } : undefined;
  });
  if (best) return reportTarget(best.value, SAFETY_REPORT, best.day);
  const member = await platformDefaultMember();
  const day = member && (await latestDay(member, SAFETY_REPORT));
  return day ? reportTarget(member!, SAFETY_REPORT, day) : undefined;
}

// ---------- 步态（地址见平台前端：采集记录页的跳转、趋势页读 memberId） ----------

/** 找最新记录时看前多少条（平台按时间倒序） */
const RECENT_SEGMENTS = 50;

/** 步态分析报告：最新一条评估过的采集记录；都没评估过就取最新的 */
export async function gaitReportTarget(): Promise<PlatformTarget | undefined> {
  const list = (await api.get<GaitSegment[]>("/api/metric-segment/pages", { params: { current: 1, pageSize: RECENT_SEGMENTS } })).data ?? [];
  const usable = list.filter((x) => x.deviceId).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const seg = usable.find((x) => x.fallRiskType) ?? usable[0];
  if (!seg) return undefined;
  const q = new URLSearchParams({ deviceId: seg.deviceId!, id: seg.id, reportNo: seg.title || seg.id });
  return { path: `/gait/analysis/report?${q}` };
}

/** 步态趋势：最近有采集记录的用户 */
export async function gaitTrendTarget(): Promise<PlatformTarget | undefined> {
  const newest = (await getSegmentMembers()).sort((a, b) => (b.lastCreatedAt ?? "").localeCompare(a.lastCreatedAt ?? ""))[0];
  return newest && { path: `/gait/trend?memberId=${encodeURIComponent(newest.memberId)}` };
}
