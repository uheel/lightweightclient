import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button } from "antd";
import { isWindowActive, notify, requestAttention, setTrayTooltip, showMainWindow } from "../desktop/desktop";
import { useAlertWatcher } from "./useAlertWatcher";
import { alertWhere } from "./state";
import type { CareAlert } from "./api";

/** 未处理的新告警，每隔多久再提醒一次 */
const REMIND_MS = 60_000;

/**
 * 告警中心（应用层，所有页面共用）：
 * - 维护待处理告警（useAlertWatcher）
 * - 新告警：应用内右下角弹出提醒；窗口不在前台时（最小化、缩到托盘、切到别的程序）
 *   同时发系统通知并让任务栏闪烁
 * - 本次运行期间新到、但还没处理的告警，每 60 秒在后台再提醒一次
 * - 托盘图标的提示文字显示待处理数量
 * - processing / setProcessing：当前打开处理弹窗的告警
 */
export function useAlertCenter(orgId: string, enabled: boolean) {
  const { notification } = App.useApp();
  const [processing, setProcessing] = useState<CareAlert | null>(null);
  /** 本次运行期间新到的告警 id（只对它们重复提醒，历史积压的不打扰） */
  const sessionNew = useRef(new Set<string>());

  const open = useCallback(
    (a: CareAlert) => {
      notification.destroy(a.id);
      showMainWindow();
      setProcessing(a);
    },
    [notification],
  );

  const onNew = useCallback(
    async (fresh: CareAlert[]) => {
      for (const a of fresh) {
        sessionNew.current.add(a.id);
        notification.error({
          key: a.id,
          message: a.alertTypeName,
          description: alertWhere(a),
          placement: "bottomRight",
          duration: 0,
          actions: (
            <Button type="primary" danger size="small" onClick={() => open(a)}>
              去处理
            </Button>
          ),
        });
      }
      if (await isWindowActive()) return;
      if (fresh.length <= 3) {
        for (const a of fresh) await notify(`告警：${a.alertTypeName}`, alertWhere(a));
      } else {
        await notify(`有 ${fresh.length} 条新告警`, fresh.slice(0, 3).map((a) => `${a.alertTypeName} · ${alertWhere(a)}`).join("\n"));
      }
      await requestAttention();
    },
    [notification, open],
  );

  const { alerts, loaded, reload } = useAlertWatcher(orgId, enabled, onNew);

  // 切换机构后清空
  useEffect(() => {
    sessionNew.current.clear();
    notification.destroy();
    setProcessing(null);
  }, [orgId, notification]);

  // 托盘提示文字
  useEffect(() => {
    if (!enabled || !loaded) return void setTrayTooltip("康养看护");
    setTrayTooltip(alerts.total ? `康养看护 · ${alerts.total} 条待处理告警` : "康养看护 · 暂无待处理告警");
  }, [alerts.total, enabled, loaded]);

  // 后台重复提醒还没处理的新告警
  const pendingRef = useRef(alerts.list);
  pendingRef.current = alerts.list;
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(async () => {
      const ids = new Set(pendingRef.current.map((a) => a.id));
      // 已处理（不在待处理列表里）的不再提醒
      for (const id of [...sessionNew.current]) if (!ids.has(id)) sessionNew.current.delete(id);
      const left = pendingRef.current.filter((a) => sessionNew.current.has(a.id));
      if (!left.length || (await isWindowActive())) return;
      await notify(`还有 ${left.length} 条告警没有处理`, left.slice(0, 3).map((a) => `${a.alertTypeName} · ${alertWhere(a)}`).join("\n"));
      await requestAttention();
    }, REMIND_MS);
    return () => window.clearInterval(t);
  }, [enabled]);

  const done = useCallback(() => {
    if (processing) {
      sessionNew.current.delete(processing.id);
      notification.destroy(processing.id);
    }
    reload();
  }, [processing, notification, reload]);

  return { alerts, processing, setProcessing: open, closeProcessing: () => setProcessing(null), done };
}
