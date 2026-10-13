import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Badge, Dropdown, Layout, Menu, Tag, TreeSelect } from "antd";
import { ApartmentOutlined, DownOutlined, LogoutOutlined, NotificationOutlined, HddOutlined, UserOutlined } from "@ant-design/icons";
import {
  findOrg,
  getOrgTree,
  session,
  signOut,
  stopRealtime,
  switchOrg,
  useRealtime,
  type OrgNode,
  type RealtimeEvent,
  type Session,
} from "@radar/core";
import DevicePage from "./DevicePage";
import RealtimePage, { STATE_TEXT } from "./RealtimePage";

type PageKey = "devices" | "realtime";

export default function MainLayout({ s }: { s: Session }) {
  const { message, notification } = App.useApp();
  const [pageKey, setPageKey] = useState<PageKey>("devices");
  const [orgTree, setOrgTree] = useState<OrgNode[]>([]);
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    getOrgTree().then(setOrgTree, (e) => message.error(`加载机构树失败：${e.message}`));
  }, [message]);

  // 实时通道：登录后连接，切换机构后重连（网页端切机构是整页刷新，效果相同）
  const onEvent = useCallback(
    (e: RealtimeEvent) => {
      setEvents((list) => [e, ...list].slice(0, 500));
      setUnread((n) => n + 1);
      if (e.method === "AntNotification" && e.payload && typeof e.payload === "object") {
        const p = e.payload as { message?: string; description?: string; type?: string };
        notification.open({ message: p.message ?? "平台通知", description: p.description, placement: "bottomRight" });
      }
    },
    [notification],
  );
  const rtState = useRealtime(s.orgId, onEvent);

  async function onSwitchOrg(value: string) {
    const node = findOrg(orgTree, value);
    if (!node || value === s.orgId) return;
    await switchOrg(node);
    message.success(`已切换到 ${node.title}`);
  }

  async function logout() {
    await stopRealtime();
    await signOut();
    session.set(null);
  }

  const displayName = s.realName || s.nickName || s.userName;
  const content = useMemo(() => {
    if (pageKey === "realtime")
      return <RealtimePage state={rtState} events={events} onClear={() => setEvents([])} />;
    // 以 orgId 作为 key：切换机构时整个页面重新挂载、重新请求
    return <DevicePage key={s.orgId} />;
  }, [pageKey, rtState, events, s.orgId]);

  return (
    <Layout className="main-layout">
      <Layout.Header className="app-header">
        <div className="brand">
          <img src="/logo.svg" alt="" width={26} height={26} />
          <span>雷达运维</span>
        </div>
        <div className="header-right">
          <ApartmentOutlined style={{ color: "#8c8c8c" }} />
          <TreeSelect
            className="org-select"
            value={s.orgId}
            treeData={orgTree}
            onChange={onSwitchOrg}
            showSearch
            treeNodeFilterProp="title"
            treeDefaultExpandedKeys={[s.orgId]}
            popupMatchSelectWidth={360}
            placeholder={s.orgName}
            variant="borderless"
            labelInValue={false}
            treeLine
          />
          <Tag color={STATE_TEXT[rtState].color} style={{ marginInlineEnd: 0 }}>
            实时{STATE_TEXT[rtState].text}
          </Tag>
          <Dropdown
            menu={{
              items: [
                { key: "info", label: `${s.userName}${s.isSa ? "（超管）" : ""}`, disabled: true },
                { type: "divider" },
                { key: "logout", label: "退出登录", icon: <LogoutOutlined />, danger: true, onClick: logout },
              ],
            }}
          >
            <span className="user">
              <UserOutlined /> {displayName} <DownOutlined style={{ fontSize: 10 }} />
            </span>
          </Dropdown>
        </div>
      </Layout.Header>
      <Layout>
        <Layout.Sider width={200} className="app-sider">
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[pageKey]}
            onClick={({ key }) => {
              setPageKey(key as PageKey);
              if (key === "realtime") setUnread(0);
            }}
            items={[
              { key: "devices", icon: <HddOutlined />, label: "设备列表" },
              {
                key: "realtime",
                icon: <NotificationOutlined />,
                label: (
                  <span className="menu-badge">
                    实时消息 <Badge count={pageKey === "realtime" ? 0 : unread} size="small" />
                  </span>
                ),
              },
            ]}
          />
        </Layout.Sider>
        <Layout.Content className="app-content">{content}</Layout.Content>
      </Layout>
    </Layout>
  );
}
