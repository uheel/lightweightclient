import { useEffect, useRef, useState } from "react";
import { deviceChannels, parseDeviceData, realtime, subscribeChannels, type DeviceDataMessage, type LiveData } from "@radar/core";

/**
 * 订阅一组设备的实时推送，按 SN 合并成最新状态（与用户端 useCareData 的做法一致）。
 * 每台设备约 1–2 秒推一次，几百台设备时推送很密，这里先攒在 ref 里，每秒刷一次界面。
 */
export function useLiveMap(sns: string[]) {
  const [map, setMap] = useState<Record<string, LiveData>>({});
  const pending = useRef<Record<string, LiveData>>({});
  const key = sns.join(",");

  useEffect(() => {
    if (!sns.length) return;
    return subscribeChannels(sns.flatMap(deviceChannels));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const off = realtime.on("DeviceData", (payload) => {
      const m = payload as DeviceDataMessage;
      if (!m?.sn) return;
      const patch = parseDeviceData(m);
      if (patch) pending.current[m.sn] = { ...pending.current[m.sn], ...patch } as LiveData;
    });
    const flush = setInterval(() => {
      const p = pending.current;
      if (!Object.keys(p).length) return;
      pending.current = {};
      setMap((prev) => {
        const next = { ...prev };
        for (const [sn, patch] of Object.entries(p)) next[sn] = { ...prev[sn], ...patch };
        return next;
      });
    }, 1000);
    return () => {
      off();
      clearInterval(flush);
    };
  }, []);

  return map;
}
