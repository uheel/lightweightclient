import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deviceChannels,
  parseDeviceData,
  realtime,
  subscribeChannels,
  type DeviceDataMessage,
  type LiveData,
} from "@radar/core";
import { getAttention, getMembers, type AttentionItem, type CareAlert, type Member } from "./api";

/**
 * 护理值守首页的数据：
 * - 长者列表（一次加载）
 * - 每位长者绑定设备的实时数据（订阅设备频道，合并 DeviceData 推送）
 * - 今日需关注名单
 * 待处理告警由应用层的 useAlertWatcher 统一维护，这里只负责按长者归组。
 */
export function useCareData(orgId: string, pendingAlerts: CareAlert[]) {
  const [members, setMembers] = useState<Member[]>([]);
  const [attention, setAttention] = useState<{ total: number; items: AttentionItem[] }>({ total: 0, items: [] });
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
    // 需关注名单只是补充信息，失败不影响主页面
    getAttention()
      .then((a) => !cancelled && setAttention(a))
      .catch(() => !cancelled && setAttention({ total: 0, items: [] }));
    return () => {
      cancelled = true;
    };
  }, [orgId]);

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

  return { members, attention, alertByMember, liveOf, loading, error, now };
}
