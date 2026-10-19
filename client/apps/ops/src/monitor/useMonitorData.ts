import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { ALARM_POSTURES, BED_POSTURES, deviceLink, POSTURE, realtime, type DeviceLink, type LiveData } from "@radar/core";
import { getAlertPage, getRadars, type OpsAlert, type Radar } from "../api/device";
import { getRooms, type Room } from "../api/room";
import { useLiveMap } from "../devices/useLiveMap";

const FMT = "YYYY-MM-DD HH:mm:ss";
/** 告警分组：1 场景，2 事件，3 离线，4 紧急求助，5 安装姿态 */
const GROUPS = [1, 2, 3, 4, 5];
/** 需要人去处理的分组（房间卡片变红）；离线、安装姿态只进告警流 */
export const CARE_GROUPS = new Set([1, 2, 4]);
/**
 * 未处理的护理告警在这个时间内发生的，房间才变红。
 * 平台上常积压几个月前没人处理的告警（测试机构有 200 多条），它们仍算进"未处理告警"、出现在告警流里，但不再让房间一直闪
 */
export const ALERT_FRESH_MS = 24 * 60 * 60 * 1000;
/** 最近这么久内测到过心率或呼吸就算在床（与用户端 careState 一致） */
const IN_BED_MS = 60_000;

export type RoomKind = "alert" | "busy" | "empty" | "offline" | "none";
export const KIND_RANK: Record<RoomKind, number> = { alert: 0, busy: 1, empty: 2, offline: 3, none: 4 };

export interface RoomTile {
  room: Room;
  devices: Radar[];
  kind: RoomKind;
  /** 大字状态：疑似坐地 / 在床 / 无人 / 离线 */
  state: string;
  /** 小字说明：1 人 · 持续 38 秒 */
  meta: string;
  /** 这个房间最新一条未处理的护理告警 */
  alert?: OpsAlert;
  people: number;
  online: number;
}

export interface MonitorAlerts {
  /** 告警流：今天的全部告警 + 更早但还没处理的，最新在前 */
  stream: OpsAlert[];
  pending: OpsAlert[];
  pendingTotal: number;
  todayTotal: number;
  loadedAt?: number;
}

/** 告警：每组取今天的和未处理的。收到告警推送时重取（合并 1 秒内的多条），另外每分钟兜底一次 */
function useAlerts(onNew: (a: OpsAlert[]) => void) {
  const [data, setData] = useState<MonitorAlerts>({ stream: [], pending: [], pendingTotal: 0, todayTotal: 0 });
  const known = useRef<Set<string> | null>(null);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const reload = useCallback(async () => {
    const range: [string, string] = [dayjs().startOf("day").format(FMT), dayjs().endOf("day").format(FMT)];
    try {
      const [today, pending] = await Promise.all([
        Promise.all(GROUPS.map((g) => getAlertPage({ group: g, range, current: 1, pageSize: 200 }).then((r) => tag(r, g)))),
        Promise.all(GROUPS.map((g) => getAlertPage({ group: g, status: 1, current: 1, pageSize: 50 }).then((r) => tag(r, g)))),
      ]);
      const byId = new Map<string, OpsAlert>();
      for (const a of [...pending.flatMap((r) => r.list), ...today.flatMap((r) => r.list)]) byId.set(a.id, a);
      const stream = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (known.current) {
        const fresh = stream.filter((a) => a.alertStatus === 1 && !known.current!.has(a.id));
        if (fresh.length) onNewRef.current(fresh);
      }
      known.current = new Set([...(known.current ?? []), ...byId.keys()]);
      setData({
        stream,
        pending: stream.filter((a) => a.alertStatus === 1),
        pendingTotal: pending.reduce((n, r) => n + r.total, 0),
        todayTotal: today.reduce((n, r) => n + r.total, 0),
        loadedAt: Date.now(),
      });
    } catch (e) {
      console.error("监控模式：加载告警失败", e);
    }
  }, []);

  useEffect(() => {
    reload();
    let timer: number | undefined;
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reload, 1000);
    };
    const offs = [realtime.on("Alert", soon), realtime.on("AlertClose", soon), realtime.on("AlertCount", soon)];
    const poll = window.setInterval(reload, 60_000);
    return () => {
      offs.forEach((off) => off());
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [reload]);

  return { ...data, reload };
}

/** 列表里没有分组字段时按查询的分组补上 */
const tag = (r: { list: OpsAlert[]; total: number }, g: number) => ({ ...r, list: r.list.map((a) => ({ ...a, alertTypeGroup: a.alertTypeGroup ?? g })) });

const placeKey = (b?: string, f?: string, r?: string) => [b ?? "", f ?? "", r ?? ""].join("|");

/** 一台在线设备的实时状态归成房间状态 */
function deviceState(live: LiveData | undefined, now: number): { kind: RoomKind; state: string; people: number } {
  if (!live) return { kind: "empty", state: "无人", people: 0 };
  if (live.posture !== undefined && ALARM_POSTURES.has(live.posture) && live.presence !== 0) return { kind: "alert", state: POSTURE[live.posture], people: Math.max(1, live.targets ?? 1) };
  if (live.fall) return { kind: "alert", state: "疑似跌倒", people: Math.max(1, live.targets ?? 1) };
  const inBed = (live.vitalsAt !== undefined && Math.max(now, live.updatedAt) - live.vitalsAt <= IN_BED_MS) || (live.posture !== undefined && BED_POSTURES.has(live.posture) && live.presence !== 0);
  const people = live.presence === 1 || inBed ? Math.max(1, live.targets ?? 1) : 0;
  if (inBed) return { kind: "busy", state: live.sleepStatus === 1 || live.sleepStatus === 2 ? "在床睡觉" : "在床", people };
  if (!people) return { kind: "empty", state: "无人", people: 0 };
  const p = live.posture;
  return { kind: "busy", state: p === 1 ? "走动" : p === 3 ? "坐着" : p === 0 || p === 4 ? "静止" : "有人", people };
}

export function durationText(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)} 天`;
  return m % 60 ? `${h} 小时 ${m % 60} 分` : `${h} 小时`;
}

const parseTime = (s?: string) => (s ? Date.parse(s.replace(" ", "T")) : NaN);

/**
 * 监控模式的全部数据：房间、雷达、实时推送、告警，房间状态在本地推出来。
 * 平台只取房间 / 雷达列表（各一次）和告警；在线、有人、在床都按设备推送判断（与设备列表、用户端规则一致）。
 */
export function useMonitorData(now: number, onNewAlerts: (a: OpsAlert[]) => void) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [radars, setRadars] = useState<Radar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, d] = await Promise.all([getRooms(), getRadars()]);
      setRooms(r);
      setRadars(d);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const sns = useMemo(() => radars.map((d) => d.sn), [radars]);
  const live = useLiveMap(sns);
  const alerts = useAlerts(onNewAlerts);

  const links = useMemo(() => {
    const m = new Map<string, DeviceLink>();
    for (const d of radars) m.set(d.sn, deviceLink({ live: live[d.sn], platformOnline: d.isOnline, now: Math.max(now, live[d.sn]?.updatedAt ?? 0) }));
    return m;
  }, [radars, live, now]);

  /** 房间状态变化的时间（本次打开监控后观察到的变化才有；刚打开时的状态不知道持续多久） */
  const since = useRef(new Map<string, { key: string; at?: number }>());
  /** 房间最近一次有人的时间，用来写"N 分钟前离开" */
  const lastBusy = useRef(new Map<string, number>());

  const tiles = useMemo(() => {
    const byRoom = new Map<string, Radar[]>();
    for (const d of radars) if (d.roomId && !d.isDisabled) byRoom.set(d.roomId, [...(byRoom.get(d.roomId) ?? []), d]);
    const snRoom = new Map(radars.flatMap((d) => (d.roomId ? [[d.sn, d.roomId] as const] : [])));
    const roomByPlace = new Map(rooms.map((r) => [placeKey(r.buildingName, r.floorName, r.roomName), r.id]));
    const alertOf = new Map<string, OpsAlert>();
    // stream 最新在前：每个房间留最新一条
    for (const a of alerts.pending) {
      if (!CARE_GROUPS.has(a.alertTypeGroup ?? 0) || !(now - parseTime(a.createdAt) <= ALERT_FRESH_MS)) continue;
      const rid = (a.sn && snRoom.get(a.sn)) || roomByPlace.get(placeKey(a.buildingName, a.floorName, a.roomName));
      if (rid && !alertOf.has(rid)) alertOf.set(rid, a);
    }

    return rooms
      .map((room): RoomTile => {
        const devices = byRoom.get(room.id) ?? [];
        const onlineDevs = devices.filter((d) => links.get(d.sn)?.online);
        const alert = alertOf.get(room.id);
        let kind: RoomKind;
        let state: string;
        let people = 0;
        if (!devices.length) {
          kind = "none";
          state = "未绑定";
        } else if (!onlineDevs.length) {
          kind = "offline";
          state = "离线";
        } else {
          const ss = onlineDevs.map((d) => deviceState(live[d.sn], now)).sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
          ({ kind, state } = ss[0]);
          // 一个房间常有几台雷达（每张床一台，再加一台看整个房间），各自数自己看到的人，加起来就是房间里的人数（和平面图上的点数一致）
          people = ss.reduce((n, s) => n + s.people, 0);
        }
        if (alert) {
          kind = "alert";
          state = alert.alertTypeName;
        }

        // 状态持续时间
        const key = `${kind}:${state}`;
        const prev = since.current.get(room.id);
        if (!prev) since.current.set(room.id, { key });
        else if (prev.key !== key) since.current.set(room.id, { key, at: now });
        const at = since.current.get(room.id)!.at;
        if (people > 0) lastBusy.current.set(room.id, now);

        let meta: string;
        if (kind === "none") meta = "未绑定设备";
        else if (kind === "offline") {
          const last = Math.max(...devices.map((d) => Math.max(live[d.sn]?.updatedAt ?? 0, parseTime(d.lastActivityTime) || 0)));
          meta = last > 0 ? `${durationText(now - last)}前有数据` : "一直没有数据";
        } else if (alert) {
          const t = parseTime(alert.createdAt);
          meta = [people ? `${people} 人` : undefined, Number.isNaN(t) ? alert.createdAt.slice(11) : `已 ${durationText(now - t)}`].filter(Boolean).join(" · ");
        } else if (kind === "empty") {
          const lb = lastBusy.current.get(room.id);
          meta = lb ? `${durationText(now - lb)}前离开` : devices.length > 1 ? `${onlineDevs.length} / ${devices.length} 台在线` : "设备在线";
        } else {
          meta = [`${people} 人`, at ? `持续 ${durationText(now - at)}` : undefined].filter(Boolean).join(" · ");
        }
        return { room, devices, kind, state, meta, alert, people, online: onlineDevs.length };
      })
      .sort(
        (a, b) =>
          KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
          (a.room.buildingSortOrder ?? 0) - (b.room.buildingSortOrder ?? 0) ||
          (a.room.buildingName ?? "").localeCompare(b.room.buildingName ?? "", "zh-CN", { numeric: true }) ||
          (a.room.floorNumber ?? 0) - (b.room.floorNumber ?? 0) ||
          a.room.roomName.localeCompare(b.room.roomName, "zh-CN", { numeric: true }),
      );
  }, [rooms, radars, links, live, alerts.pending, now]);

  const stats = useMemo(() => {
    const active = radars.filter((d) => !d.isDisabled);
    const withDevices = tiles.filter((t) => t.kind !== "none");
    return {
      online: active.filter((d) => links.get(d.sn)?.online).length,
      devices: active.length,
      busyRooms: withDevices.filter((t) => t.people > 0 || t.kind === "busy").length,
      rooms: withDevices.length,
    };
  }, [radars, links, tiles]);

  return { loading, error, reload: load, rooms, radars, live, links, tiles, stats, alerts };
}
