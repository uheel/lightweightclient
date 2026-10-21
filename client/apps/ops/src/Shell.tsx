import { useCallback, useState } from "react";
import { App } from "antd";
import { AlertOutlined, DeploymentUnitOutlined, FundProjectionScreenOutlined, HddOutlined, HomeOutlined, LogoutOutlined, MedicineBoxOutlined, NotificationOutlined, TeamOutlined } from "@ant-design/icons";
import { AppShell, OrgPicker, session, signOut, stopRealtime, useRealtime, type RealtimeEvent, type Session, type ShellNavItem } from "@radar/core";
import DevicesPage from "./pages/DevicesPage";
import RoomsPage from "./pages/RoomsPage";
import SpacesPage from "./pages/SpacesPage";
import AlertsPage from "./pages/AlertsPage";
import ScenesPage from "./pages/ScenesPage";
import MembersPage from "./pages/MembersPage";
import RealtimePage, { STATE_TEXT } from "./pages/RealtimePage";
import MonitorMode from "./monitor/MonitorMode";
import { GuideProvider } from "./guide/GuideContext";
import { GuideBanner, GuideDrawer, GuideRailEntry } from "./guide/GuideDrawer";

type NavKey = "devices" | "spaces" | "rooms" | "scenes" | "members" | "alerts" | "realtime";
/** 侧栏上的"监控"不是一个页面，而是打开全屏的监控模式 */
type RailKey = NavKey | "monitor";

async function logout() {
  await stopRealtime();
  await signOut();
  session.set(null);
}

/** 运维端外壳（与用户端共用 core 的 AppShell） */
export default function Shell({ s }: { s: Session }) {
  const { notification } = App.useApp();
  const [nav, setNav] = useState<NavKey>("devices");
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [monitor, setMonitor] = useState(false);

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

  const items: ShellNavItem<RailKey>[] = [
    { key: "monitor", label: "监控", icon: <FundProjectionScreenOutlined /> },
    { key: "devices", label: "设备", icon: <HddOutlined /> },
    { key: "spaces", label: "楼宇", icon: <HomeOutlined /> },
    { key: "scenes", label: "场景", icon: <DeploymentUnitOutlined /> },
    { key: "members", label: "长者", icon: <TeamOutlined /> },
    { key: "alerts", label: "告警", icon: <AlertOutlined /> },
    { key: "rooms", label: "诊断", icon: <MedicineBoxOutlined /> },
    { key: "realtime", label: "推送", icon: <NotificationOutlined />, badge: nav === "realtime" ? 0 : unread },
  ];

  const go = (k: RailKey) => {
    if (k === "monitor") return setMonitor(true);
    setNav(k);
    if (k === "realtime") setUnread(0);
  };

  const displayName = s.realName || s.nickName || s.userName;
  const st = STATE_TEXT[rt];

  return (
    // 以 orgId 作为 key：切换机构时快速开始的检查结果和本机记录都换成新机构的
    <GuideProvider key={s.orgId} orgId={s.orgId} nav={nav} onNav={go}>
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
            { key: "logout", label: "退出登录", icon: <LogoutOutlined />, danger: true, onClick: logout },
          ],
        }}
        nav={items}
        active={nav}
        onNav={go}
        railFooter={<GuideRailEntry />}
      >
        {/* 以 orgId 作为 key：切换机构时页面整体重新挂载、重新请求。快速开始清单浮在页面右上角，可以拖动、收起 */}
        <div key={s.orgId} className="guide-layout">
          <div className="guide-page">
            <GuideBanner />
            <div className="guide-page-body">
              {nav === "devices" ? (
                <DevicesPage />
              ) : nav === "spaces" ? (
                <SpacesPage />
              ) : nav === "rooms" ? (
                <RoomsPage />
              ) : nav === "scenes" ? (
                <ScenesPage />
              ) : nav === "members" ? (
                <MembersPage />
              ) : nav === "alerts" ? (
                <AlertsPage />
              ) : (
                <RealtimePage state={rt} events={events} onClear={() => setEvents([])} />
              )}
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
      </AppShell>
    </GuideProvider>
  );
}
