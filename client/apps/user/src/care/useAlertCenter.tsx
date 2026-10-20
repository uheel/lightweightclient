import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button } from "antd";
import { isTauri } from "@radar/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  chime,
  isWindowActive,
  onPopupAction,
  pushPopup,
  requestAttention,
  setTrayTooltip,
  showMainWindow,
  type PopupAlert,
} from "../desktop/desktop";
import { useAlertWatcher } from "./useAlertWatcher";
import { alertLocation, alertWhere } from "./state";
import type { CareAlert } from "./api";

/** 未处理的新告警，每隔多久再提醒一次（"稍后提醒"也是隔这么久） */
const REMIND_MS = 60_000;

const toPopup = (a: CareAlert): PopupAlert => ({
  id: a.id,
  type: a.alertTypeName,
  who: a.members?.map((m) => m.realName).join("、") || undefined,
  where: alertLocation(a) || "位置未配置",
  createdAt: a.createdAt,
});

/**
 * 告警中心（应用层，所有页面共用）：
 * - 维护待处理告警（useAlertWatcher）
 * - 新告警：主窗口在前台时，应用内右下角弹出提醒；
 *   不在前台时（最小化、缩到托盘、切到别的程序），在屏幕右下角弹出告警弹窗（src/desktop/AlertPopup.tsx）、响提示音、任务栏闪烁
 * - 本次运行期间新到、但还没处理的告警，弹窗一直挂着；点了"稍后提醒"的，60 秒后再弹
 * - 托盘图标的提示文字显示待处理数量
 * - processing / setProcessing：当前打开处理弹窗的告警
 */
export function useAlertCenter(orgId: string, enabled: boolean) {
  const { notification } = App.useApp();
  const [processing, setProcessing] = useState<CareAlert | null>(null);
  /** 本次运行期间新到的告警 id（只对它们提醒，历史积压的不打扰） */
  const sessionNew = useRef(new Set<string>());
  /** 主窗口是否在前台（可见且有焦点） */
  const active = useRef(true);
  /** 点了"稍后提醒"后，到这个时间之前不弹（新告警到达会打断） */
  const snoozeUntil = useRef(0);

  const open = useCallback(
    (a: CareAlert) => {
      notification.destroy(a.id);
      showMainWindow();
      setProcessing(a);
    },
    [notification],
  );

  // syncPopup 要读最新的待处理列表，但 onNew 在 useAlertWatcher 之前定义，所以走 ref
  const pendingRef = useRef<CareAlert[]>([]);

  /** 把弹窗该显示的内容推给弹窗窗口 */
  const syncPopup = useCallback(() => {
    const ids = new Set(pendingRef.current.map((a) => a.id));
    // 已处理（不在待处理列表里）的不再提醒
    for (const id of [...sessionNew.current]) if (!ids.has(id)) sessionNew.current.delete(id);
    const list = pendingRef.current.filter((a) => sessionNew.current.has(a.id));
    pushPopup({ alerts: list.map(toPopup), visible: !active.current && Date.now() >= snoozeUntil.current && list.length > 0 });
  }, []);

  const onNew = useCallback(
    async (fresh: CareAlert[]) => {
      for (const a of fresh) {
        sessionNew.current.add(a.id);
        // 图标用和告警弹窗一样的红色呼吸点（替换 antd 默认的红色 ×），样式见 styles.css
        notification.open({
          key: a.id,
          icon: (
            <span className="notice-pulse">
              <i />
            </span>
          ),
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
      active.current = await isWindowActive();
      if (active.current) return;
      snoozeUntil.current = 0;
      chime();
      await requestAttention();
    },
    [notification, open],
  );

  const { alerts, loaded, reload } = useAlertWatcher(orgId, enabled, onNew);
  pendingRef.current = alerts.list;

  // 待处理列表变了（新到、被处理、切换机构）就同步弹窗
  useEffect(syncPopup, [alerts.list, syncPopup]);

  // 主窗口切到前台时收起弹窗，离开前台时把还没处理的告警弹出来
  useEffect(() => {
    if (!isTauri) return;
    isWindowActive().then((v) => {
      active.current = v;
      syncPopup();
    });
    let timer: number | undefined;
    const off = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      window.clearTimeout(timer);
      if (focused) {
        active.current = true;
        syncPopup();
        return;
      }
      // 点击窗口时，焦点会在外层窗口和里面的 WebView 之间来回切（先报失焦、紧接着又报得焦），
      // 直接按失焦弹出会让弹窗闪一下。等一会儿再确认窗口确实不在前台
      timer = window.setTimeout(async () => {
        active.current = await isWindowActive();
        syncPopup();
      }, 400);
    });
    return () => {
      window.clearTimeout(timer);
      void off.then((f) => f());
    };
  }, [syncPopup]);

  // 弹窗上的操作
  useEffect(
    () =>
      onPopupAction({
        ready: syncPopup,
        open: (id) => {
          const a = pendingRef.current.find((x) => x.id === id);
          if (a) open(a);
          else showMainWindow();
        },
        snooze: () => {
          snoozeUntil.current = Date.now() + REMIND_MS;
          syncPopup();
        },
      }),
    [open, syncPopup],
  );

  // 切换机构后清空；退出登录（卸载）时收起弹窗
  useEffect(() => {
    sessionNew.current.clear();
    snoozeUntil.current = 0;
    notification.destroy();
    setProcessing(null);
    syncPopup();
    return () => pushPopup({ alerts: [], visible: false });
  }, [orgId, notification, syncPopup]);

  // 托盘提示文字
  useEffect(() => {
    if (!enabled || !loaded) return void setTrayTooltip("Health Guardian");
    setTrayTooltip(alerts.total ? `Health Guardian · ${alerts.total} 条待处理告警` : "Health Guardian · 暂无待处理告警");
  }, [alerts.total, enabled, loaded]);

  // "稍后提醒"到点、或者弹窗还挂着时，每 60 秒再响一次、闪一次任务栏
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(async () => {
      if (active.current || Date.now() < snoozeUntil.current) return;
      const left = pendingRef.current.filter((a) => sessionNew.current.has(a.id));
      if (!left.length) return;
      syncPopup();
      chime();
      await requestAttention();
    }, REMIND_MS);
    return () => window.clearInterval(t);
  }, [enabled, syncPopup]);

  const done = useCallback(() => {
    if (processing) {
      sessionNew.current.delete(processing.id);
      notification.destroy(processing.id);
    }
    reload();
  }, [processing, notification, reload]);

  return { alerts, processing, setProcessing: open, closeProcessing: () => setProcessing(null), done };
}
