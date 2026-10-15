import { useCallback, useState } from "react";
import { App } from "antd";
import { AlertOutlined, DeploymentUnitOutlined, FileSearchOutlined, HddOutlined, LogoutOutlined, NotificationOutlined } from "@ant-design/icons";
import { AppShell, OrgPicker, session, signOut, stopRealtime, useRealtime, type RealtimeEvent, type Session, type ShellNavItem } from "@radar/core";
import DevicesPage from "./pages/DevicesPage";
import AlertsPage from "./pages/AlertsPage";
import LogsPage from "./pages/LogsPage";
import ScenesPage from "./pages/ScenesPage";
import RealtimePage, { STATE_TEXT } from "./pages/RealtimePage";

type NavKey = "devices" | "scenes" | "alerts" | "logs" | "realtime";

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
  /** 从其他页面跳到日志页时带上的 SN */
  const [logSn, setLogSn] = useState<string>();

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

  const items: ShellNavItem<NavKey>[] = [
    { key: "devices", label: "设备", icon: <HddOutlined /> },
    { key: "scenes", label: "场景", icon: <DeploymentUnitOutlined /> },
    { key: "alerts", label: "告警", icon: <AlertOutlined /> },
    { key: "logs", label: "日志", icon: <FileSearchOutlined /> },
    { key: "realtime", label: "推送", icon: <NotificationOutlined />, badge: nav === "realtime" ? 0 : unread },
  ];

  const go = (k: NavKey) => {
    setNav(k);
    if (k === "realtime") setUnread(0);
  };
  const openLogs = (sn: string) => {
    setLogSn(sn);
    go("logs");
  };

  const displayName = s.realName || s.nickName || s.userName;
  const st = STATE_TEXT[rt];

  return (
    <AppShell
      appName="雷达运维"
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
    >
      {/* 以 orgId 作为 key：切换机构时页面整体重新挂载、重新请求 */}
      <div key={s.orgId} style={{ height: "100%" }}>
        {nav === "devices" ? (
          <DevicesPage onOpenLogs={openLogs} />
        ) : nav === "scenes" ? (
          <ScenesPage />
        ) : nav === "alerts" ? (
          <AlertsPage />
        ) : nav === "logs" ? (
          <LogsPage initialSn={logSn} />
        ) : (
          <RealtimePage state={rt} events={events} onClear={() => setEvents([])} />
        )}
      </div>
    </AppShell>
  );
}
