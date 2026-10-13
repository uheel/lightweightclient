import { useCallback, useEffect, useRef, useState } from "react";
import { realtime } from "@radar/core";
import { getPendingAlerts, type CareAlert } from "./api";

/**
 * 全局的待处理告警：整个应用只有这一份数据，首页和提醒都用它。
 * - 收到 Alert / AlertClose / AlertCount 推送时重新拉取（短时间内多条只拉一次）
 * - 每 60 秒兜底拉取一次，防止推送丢失（例如断线重连期间）
 * - 找出"本次运行期间新出现的告警"交给 onNew；首次加载的历史告警不算新告警
 *
 * 判断"新"要看发生时间，不能只看 id：列表只取最近 N 条，处理掉一条后，
 * 更早的旧告警会补进列表，它的 id 虽然没见过，但并不是新告警。
 * 所以只有发生时间不早于"已见过的最新告警"、且 id 没见过的，才算新告警。
 */
export function useAlertWatcher(orgId: string, enabled: boolean, onNew: (alerts: CareAlert[]) => void) {
  const [alerts, setAlerts] = useState<{ list: CareAlert[]; total: number }>({ list: [], total: 0 });
  const [loaded, setLoaded] = useState(false);
  const known = useRef<Set<string> | null>(null);
  /** 已见过的最新告警发生时间（"YYYY-MM-DD HH:mm:ss"，可直接按字符串比较） */
  const watermark = useRef("");
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const reload = useCallback(async () => {
    try {
      const a = await getPendingAlerts();
      const ids = new Set(a.list.map((x) => x.id));
      if (known.current) {
        const fresh = a.list.filter((x) => !known.current!.has(x.id) && x.createdAt >= watermark.current);
        if (fresh.length) onNewRef.current(fresh);
      }
      for (const x of a.list) if (x.createdAt > watermark.current) watermark.current = x.createdAt;
      // 已经见过的 id 保留，避免告警掉出前 30 条后再回来时被当成新告警
      known.current = new Set([...(known.current ?? []), ...ids]);
      setAlerts(a);
      setLoaded(true);
    } catch (e) {
      console.error("加载待处理告警失败", e);
    }
  }, []);

  useEffect(() => {
    known.current = null;
    watermark.current = "";
    setLoaded(false);
    setAlerts({ list: [], total: 0 });
    if (!enabled) return;
    reload();
    let timer: number | undefined;
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reload, 800);
    };
    const offs = [realtime.on("Alert", soon), realtime.on("AlertClose", soon), realtime.on("AlertCount", soon)];
    const poll = window.setInterval(reload, 60_000);
    return () => {
      offs.forEach((off) => off());
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [orgId, enabled, reload]);

  return { alerts, loaded, reload };
}
