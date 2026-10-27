import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button } from "antd";
import {
  chime,
  destroyPopupWindow,
  ensurePopupWindow,
  isTauri,
  isWindowActive,
  onPopupAction,
  pushPopup,
  realtime,
  requestAttention,
  showMainWindow,
  type PopupAlert,
} from "@radar/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAlertPage, type OpsAlert } from "../api/device";
import type { PopupSettings } from "./popupSettings";

/** 未处理的新告警，每隔多久再提醒一次（"稍后提醒"也是隔这么久） */
const REMIND_MS = 60_000;
/** 每个分组取最近几条未处理告警 */
const LIMIT = 30;

const device = (a: OpsAlert) => [a.deviceName, a.sn].filter(Boolean).join(" · ") || undefined;
const where = (a: OpsAlert) => [a.buildingName, a.floorName, a.roomName].filter(Boolean).join(" · ") || "位置未配置";

const toPopup = (a: OpsAlert): PopupAlert => ({ id: a.id, type: a.alertTypeName, who: device(a), where: where(a), createdAt: a.createdAt });

/**
 * 告警弹窗（和用户端 useAlertCenter 一样的提醒方式，系统设置里打开后才工作）：
 * - 维护勾选分组里的未处理告警：收到 Alert / AlertClose / AlertCount 推送时重新拉取，每 60 秒兜底拉一次
 * - 新告警：主窗口在前台时，应用内右下角弹出提醒（监控模式开着时不弹，监控模式有自己的告警列表）；
 *   不在前台时（最小化、切到别的程序），在屏幕右下角弹出告警弹窗、响提示音、任务栏闪烁
 * - 本次运行期间新到、但还没处理的告警，弹窗一直挂着；点了"稍后提醒"的，60 秒后再弹
 * - 打开时已经积压的告警不算新告警，不打扰
 *
 * 判断"新"要看发生时间，不能只看 id：列表只取最近 N 条，处理掉一条后更早的旧告警会补进来，
 * 所以只有发生时间不早于"已见过的最新告警"、且 id 没见过的，才算新告警。
 */
export function useAlertCenter(orgId: string, settings: PopupSettings, quiet: boolean) {
  const { notification } = App.useApp();
  const { enabled } = settings;
  const groupKey = settings.groups.join(",");
  const [processing, setProcessing] = useState<OpsAlert | null>(null);
  const pending = useRef<OpsAlert[]>([]);
  const known = useRef<Set<string> | null>(null);
  /** 已见过的最新告警发生时间（"YYYY-MM-DD HH:mm:ss"，可直接按字符串比较） */
  const watermark = useRef("");
  /** 本次运行期间新到的告警 id（只对它们提醒） */
  const sessionNew = useRef(new Set<string>());
  /** 主窗口是否在前台（可见且有焦点） */
  const active = useRef(true);
  /** 点了"稍后提醒"后，到这个时间之前不弹（新告警到达会打断） */
  const snoozeUntil = useRef(0);
  const quietRef = useRef(quiet);
  quietRef.current = quiet;

  const open = useCallback(
    (a: OpsAlert) => {
      notification.destroy(a.id);
      showMainWindow();
      setProcessing(a);
    },
    [notification],
  );

  /** 把弹窗该显示的内容推给弹窗窗口 */
  const syncPopup = useCallback(() => {
    const ids = new Set(pending.current.map((a) => a.id));
    // 已处理（不在待处理列表里）的不再提醒
    for (const id of [...sessionNew.current]) if (!ids.has(id)) sessionNew.current.delete(id);
    const list = pending.current.filter((a) => sessionNew.current.has(a.id));
    pushPopup({ alerts: list.map(toPopup), visible: enabled && !active.current && Date.now() >= snoozeUntil.current && list.length > 0 });
  }, [enabled]);

  const onNew = useCallback(
    async (fresh: OpsAlert[]) => {
      for (const a of fresh) {
        sessionNew.current.add(a.id);
        if (quietRef.current) continue;
        // 图标用和告警弹窗一样的红色呼吸点，样式见 styles.css
        notification.open({
          key: a.id,
          icon: (
            <span className="notice-pulse">
              <i />
            </span>
          ),
          message: a.alertTypeName,
          description: [device(a), where(a)].filter(Boolean).join(" · "),
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
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const reload = useCallback(async () => {
    const groups = groupKey ? groupKey.split(",").map(Number) : [];
    try {
      const pages = await Promise.all(groups.map((group) => getAlertPage({ group, status: 1, current: 1, pageSize: LIMIT })));
      const list = pages.flatMap((p) => p.list).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (known.current) {
        const fresh = list.filter((x) => !known.current!.has(x.id) && x.createdAt >= watermark.current);
        if (fresh.length) void onNewRef.current(fresh);
      }
      for (const x of list) if (x.createdAt > watermark.current) watermark.current = x.createdAt;
      // 已经见过的 id 保留，避免告警掉出前 30 条后再回来时被当成新告警
      known.current = new Set([...(known.current ?? []), ...list.map((x) => x.id)]);
      pending.current = list;
      syncPopup();
    } catch (e) {
      console.error("加载待处理告警失败", e);
    }
  }, [groupKey, syncPopup]);

  // 切换机构、改了分组、开关弹窗：从头开始，当时已有的告警都不算新的
  useEffect(() => {
    known.current = null;
    watermark.current = "";
    pending.current = [];
    sessionNew.current.clear();
    snoozeUntil.current = 0;
    notification.destroy();
    setProcessing(null);
    syncPopup();
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
      pushPopup({ alerts: [], visible: false });
    };
  }, [orgId, enabled, reload, notification, syncPopup]);

  // 打开时建好弹窗窗口；关了就销毁，不占内存
  useEffect(() => {
    if (enabled) ensurePopupWindow();
    else destroyPopupWindow();
  }, [enabled]);

  // 主窗口切到前台时收起弹窗，离开前台时把还没处理的告警弹出来
  useEffect(() => {
    if (!isTauri || !enabled) return;
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
  }, [enabled, syncPopup]);

  // 弹窗上的操作
  useEffect(
    () =>
      onPopupAction({
        ready: syncPopup,
        open: (id) => {
          const a = pending.current.find((x) => x.id === id);
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

  // "稍后提醒"到点、或者弹窗还挂着时，每 60 秒再响一次、闪一次任务栏
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(async () => {
      if (active.current || Date.now() < snoozeUntil.current) return;
      if (!pending.current.some((a) => sessionNew.current.has(a.id))) return;
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
    setProcessing(null);
    reload();
  }, [processing, notification, reload]);

  return { processing, closeProcessing: () => setProcessing(null), done };
}
