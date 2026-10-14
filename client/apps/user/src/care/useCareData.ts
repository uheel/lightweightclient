import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deviceChannels,
  parseDeviceData,
  realtime,
  subscribeChannels,
  type DeviceDataMessage,
  type LiveData,
} from "@radar/core";
import dayjs from "dayjs";
import { getMembers, type CareAlert, type Member } from "./api";
import { getOrgSleepReports, type SleepReport } from "./health";
import { buildAttention } from "./attention";

/**
 * 护理值守首页的数据：
 * - 长者列表（一次加载）
 * - 每位长者绑定设备的实时数据（订阅设备频道，合并 DeviceData 推送）
 * - 今日需关注名单
 * 待处理告警由应用层的 useAlertWatcher 统一维护，这里只负责按长者归组。
 */
export function useCareData(orgId: string, pendingAlerts: CareAlert[]) {
  const [members, setMembers] = useState<Member[]>([]);
  /** 昨夜睡眠报告（按设备来源逐个查询），undefined 表示还在查询 */
  const [sleepReports, setSleepReports] = useState<Map<string, SleepReport>>();
  const [liveBySn, setLiveBySn] = useState<Record<string, LiveData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now());

  // 初次加载 / 切换机构
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setLiveBySn({});
    getMembers()
      .then((m) => !cancelled && setMembers(m))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    setSleepReports(undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // 昨夜睡眠报告：长者列表加载后按设备来源逐个查询（与健康页共用缓存）
  useEffect(() => {
    if (!members.length) return;
    let cancelled = false;
    getOrgSleepReports(orgId, members, dayjs().format("YYYY-MM-DD")).then(
      (list) => !cancelled && setSleepReports(new Map(list.map((x) => [x.memberId, x]))),
      () => !cancelled && setSleepReports(new Map()),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, members]);

  // 今日需关注：客户端按设备数据自己判断（规则见 attention.ts）
  const attention = useMemo(() => buildAttention(members, sleepReports, pendingAlerts), [members, sleepReports, pendingAlerts]);

  // 订阅所有长者设备的频道
  const sns = useMemo(() => [...new Set(members.flatMap((m) => m.devices?.map((d) => d.sn) ?? []))].filter(Boolean), [members]);
  useEffect(() => {
    if (!sns.length) return;
    return subscribeChannels(sns.flatMap(deviceChannels));
  }, [sns]);

  // 合并设备实时数据
  useEffect(
    () =>
      realtime.on("DeviceData", (payload) => {
        const m = payload as DeviceDataMessage;
        if (!m?.sn) return;
        const patch = parseDeviceData(m);
        if (!patch) return;
        setLiveBySn((prev) => ({ ...prev, [m.sn]: { ...prev[m.sn], ...patch } as LiveData }));
      }),
    [],
  );

  // 每 30 秒刷新一次"已持续多久"之类的相对时间
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  /** 一位长者可能绑了多台设备：按时间先后合并，后到的数据覆盖先到的 */
  const liveOf = useCallback(
    (m: Member): LiveData | undefined => {
      const list = (m.devices ?? []).map((d) => liveBySn[d.sn]).filter(Boolean) as LiveData[];
      if (!list.length) return undefined;
      return list.sort((a, b) => a.updatedAt - b.updatedAt).reduce((acc, x) => ({ ...acc, ...x }), {} as LiveData);
    },
    [liveBySn],
  );

  /** 每位长者最新的一条待处理告警 */
  const alertByMember = useMemo(() => {
    const map: Record<string, CareAlert> = {};
    for (const a of pendingAlerts) for (const mm of a.members ?? []) if (!map[mm.memberId]) map[mm.memberId] = a;
    return map;
  }, [pendingAlerts]);

  return { members, attention, sleepReports, alertByMember, liveOf, loading, error, now };
}
