import { useCallback, useEffect, useState } from "react";
import { App } from "antd";
import { LogoutOutlined, SettingOutlined } from "@ant-design/icons";
import { AppShell, OrgPicker, session, signOut, stopRealtime, useRealtime, type RealtimeEvent, type Session } from "@radar/core";
import DevicesPage from "./pages/DevicesPage";
import RoomsPage from "./pages/RoomsPage";
import SpacesPage from "./pages/SpacesPage";
import AlertsPage from "./pages/AlertsPage";
import ProcessTypesPage from "./pages/ProcessTypesPage";
import SettingsPage from "./pages/SettingsPage";
import DataWallPage from "./pages/DataWallPage";
import ScenesPage from "./pages/ScenesPage";
import MembersPage from "./pages/MembersPage";
import CaregiversPage from "./pages/CaregiversPage";
import RealtimePage, { STATE_TEXT } from "./pages/RealtimePage";
import MonitorMode from "./monitor/MonitorMode";
import { ProcessDialog } from "./alerts/ProcessDialog";
import { useAlertCenter } from "./alerts/useAlertCenter";
import { usePopupSettings } from "./alerts/popupSettings";
import { GuideProvider } from "./guide/GuideContext";
import { GuideBanner, GuideDrawer, GuideEntry } from "./guide/GuideDrawer";
import type { NavKey } from "./guide/steps";
import { WorkTabs, type TabKey } from "./workspace/WorkTabs";
import { Workbench } from "./workspace/Workbench";
import type { ModuleKey } from "./workspace/modules";
import { useNames } from "./workspace/names";
import "./workspace/workspace.css";

const PANE_ORDER: NavKey[] = ["devices", "spaces", "rooms", "scenes", "members", "caregivers", "alerts", "processTypes", "realtime", "settings", "dataWall"];

async function logout() {
  await stopRealtime();
  await signOut();
  session.set(null);
}

/** 运维端外壳（与用户端共用 core 的 AppShell）：没有左侧模块栏，登录后是工作台，模块在标题栏里以标签打开 */
export default function Shell({ s }: { s: Session }) {
  const { notification } = App.useApp();
  /** 打开的模块标签（顺序即标签顺序）；每次登录都从工作台开始 */
  const [tabs, setTabs] = useState<NavKey[]>([]);
  const [active, setActive] = useState<TabKey>("home");
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [monitor, setMonitor] = useState(false);
  // 告警弹窗（系统设置里打开）；监控模式有自己的告警列表，开着时不在应用内弹提醒
  const alertCenter = useAlertCenter(s.orgId, usePopupSettings(), monitor);

  const onEvent = useCallback(
    (e: RealtimeEvent) => {
      // 设备数据推送量很大，实时消息页只留最近 500 条
      setEvents((list) => [e, ...list].slice(0, 500));
      if (e.method !== "DeviceData") setUnread((n) => n + 1);
      if (e.method === "AntNotification" && e.payload && typeof e.payload === "object") {
        const p = e.payload as { message?: string; description?: string };
        notification.open({ message: p.message ?? "平台通知", description: p.description, placement: "bottomRight" });
      }
    },
    [notification],
  );
  const rt = useRealtime(s.orgId, onEvent);
  const names = useNames();

  /** 打开模块：已经开着就切过去；监控不开标签，打开全屏监控模式 */
  const go = useCallback((k: ModuleKey | "home") => {
    if (k === "monitor") return setMonitor(true);
    if (k !== "home") setTabs((t) => (t.includes(k) ? t : [...t, k]));
    setActive(k);
  }, []);

  // 推送页开着时新消息直接算已读
  useEffect(() => {
    if (active === "realtime" && unread) setUnread(0);
  }, [active, unread]);

  /** 关掉的是当前标签时，切到它左边的那个（没有就回工作台） */
  const close = useCallback(
    (keys: NavKey[]) => {
      const i = active === "home" ? -1 : tabs.indexOf(active);
      const rest = tabs.filter((t) => !keys.includes(t));
      setTabs(rest);
      if (active !== "home" && keys.includes(active)) setActive(tabs.slice(0, i).reverse().find((t) => rest.includes(t)) ?? rest[0] ?? "home");
    },
    [tabs, active],
  );

  // Ctrl+W 关闭当前标签，Ctrl+Tab / Ctrl+Shift+Tab 切换，Ctrl+1 回工作台（监控模式开着时不处理）
  useEffect(() => {
    if (monitor) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const all: TabKey[] = ["home", ...tabs];
      if (e.key === "Tab") {
        const i = all.indexOf(active);
        go(all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]);
      } else if (e.key.toLowerCase() === "w") {
        if (active !== "home") close([active]);
      } else if (e.key === "1") go("home");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [monitor, tabs, active, go, close]);

  const displayName = s.realName || s.nickName || s.userName;
  const st = STATE_TEXT[rt];

  return (
    // 以 orgId 作为 key：切换机构时快速开始的检查结果和本机记录都换成新机构的
    <GuideProvider key={s.orgId} orgId={s.orgId} nav={active} onNav={go}>
      <AppShell
        appName="Radar Config"
        org={<OrgPicker s={s} className="shell-org" fallback={<span className="shell-pill">{s.orgName}</span>} />}
        live={{ text: `实时${st.text}`, color: st.dot, title: "SignalR /hub/message" }}
        user={{
          name: displayName,
          sub: s.isSa ? "超管" : undefined,
          menu: [
            { key: "info", label: s.userName, disabled: true },
            { type: "divider" },
            // 工作台上可以把系统设置隐藏，这里总能进
            { key: "settings", label: names.module("settings"), icon: <SettingOutlined />, onClick: () => go("settings") },
            { key: "logout", label: "退出登录", icon: <LogoutOutlined />, danger: true, onClick: logout },
          ],
        }}
        tabs={<WorkTabs tabs={tabs} active={active} badges={{ realtime: unread }} onSelect={go} onClose={close} onReorder={setTabs} />}
        actions={<GuideEntry />}
      >
        {/* 以 orgId 作为 key：切换机构时页面整体重新挂载、重新请求。快速开始清单浮在页面右上角，可以拖动、收起 */}
        <div key={s.orgId} className="guide-layout">
          <div className="guide-page">
            <GuideBanner />
            {/* 打开的标签都保持挂载、只是隐藏，切回来时筛选、选中、滚动位置都还在 */}
            <div className="guide-page-body">
              <div className="tab-pane" hidden={active !== "home"} style={{ overflow: "auto" }}>
                <Workbench s={s} unread={unread} onOpen={go} />
              </div>
              {/* 按固定顺序渲染，拖动标签排序时页面的 DOM 不移动（移动会丢滚动位置） */}
              {PANE_ORDER.filter((k) => tabs.includes(k)).map((k) => (
                <div key={k} className="tab-pane" hidden={active !== k}>
                  {k === "devices" ? (
                    <DevicesPage />
                  ) : k === "spaces" ? (
                    <SpacesPage />
                  ) : k === "rooms" ? (
                    <RoomsPage />
                  ) : k === "scenes" ? (
                    <ScenesPage />
                  ) : k === "members" ? (
                    <MembersPage />
                  ) : k === "caregivers" ? (
                    <CaregiversPage />
                  ) : k === "alerts" ? (
                    <AlertsPage />
                  ) : k === "processTypes" ? (
                    <ProcessTypesPage />
                  ) : k === "settings" ? (
                    <SettingsPage />
                  ) : k === "dataWall" ? (
                    <DataWallPage />
                  ) : (
                    <RealtimePage state={rt} events={events} onClear={() => setEvents([])} />
                  )}
                </div>
              ))}
            </div>
          </div>
          <GuideDrawer orgName={s.orgName} />
        </div>
        {monitor && (
          <MonitorMode
            key={`monitor-${s.orgId}`}
            s={s}
            rt={rt}
            onExit={(to) => {
              setMonitor(false);
              if (to) go(to);
            }}
          />
        )}
        <ProcessDialog alerts={alertCenter.processing && [alertCenter.processing]} onClose={alertCenter.closeProcessing} onDone={alertCenter.done} />
      </AppShell>
    </GuideProvider>
  );
}
