import { useEffect, useState, type ReactNode } from "react";
import { Button, Dropdown, Result, type MenuProps } from "antd";
import { AppstoreOutlined, BellOutlined, DownOutlined, HeartOutlined, LogoutOutlined, SwapOutlined, UserOutlined } from "@ant-design/icons";
import { hasAnyPermission, OrgPicker, RES, session, signOut, status, stopRealtime, useRealtime, type Session } from "@radar/core";
import { availableRoles, ROLE_LABEL, type Role } from "./roles";
import Placeholder from "./pages/Placeholder";
import CareHome from "./pages/CareHome";
import AlertProcessDialog from "./care/AlertProcessDialog";
import { useAlertCenter } from "./care/useAlertCenter";
import { useCareData } from "./care/useCareData";
import { CareProvider, type CareCtx } from "./care/CareContext";
import ElderDetail from "./pages/ElderDetail";
import EldersPage from "./pages/EldersPage";
import AlertsPage from "./pages/AlertsPage";
import HealthPage from "./pages/HealthPage";

type NavKey = "home" | "elders" | "alerts" | "health";

const HOME_DESC: Record<Role, string> = {
  care: "长者卡片墙 · 待处理告警 · 今日需关注（界面稿：护理值守 · 首页）",
  family: "家人现在的状态 · 今天的活动 · 昨晚睡眠（界面稿：家属 · 首页）",
  manager: "关键指标 · 各护理区对比 · 告警处理情况（界面稿：机构管理者 · 概览）",
};

/** 开发模式下可以预览所有角色的首页（打包后的安装包里没有这个入口） */
const DEV_PREVIEW = import.meta.env.DEV;

async function logout() {
  await stopRealtime();
  await signOut();
  session.set(null);
}

export default function Shell({ s }: { s: Session }) {
  const roles = availableRoles(s);
  const [role, setRole] = useState<Role | undefined>(roles[0]);
  const [nav, setNav] = useState<NavKey>("home");
  const rt = useRealtime(s.orgId);
  // 告警中心：有告警权限的账号才启用（管理者视图下也照常提醒）
  const alertCenter = useAlertCenter(s.orgId, hasAnyPermission(s, [...RES.alert]));
  // 长者列表与实时状态：所有模块共用一份（只订阅一次设备频道）
  const care = useCareData(s.orgId, alertCenter.alerts.list);
  const now = care.now;
  /** 正在查看详情的长者；切换模块或机构时关闭 */
  const [detailId, setDetailId] = useState<string>();
  useEffect(() => setDetailId(undefined), [s.orgId]);
  const ctx: CareCtx = {
    ...care,
    s,
    alerts: alertCenter.alerts,
    openElder: setDetailId,
    process: alertCenter.setProcessing,
    reloadAlerts: alertCenter.done,
  };

  // 切换机构后权限会变，重新判断角色
  const rolesKey = roles.join(",");
  useEffect(() => {
    setRole((cur) => (cur && (roles.includes(cur) || DEV_PREVIEW) ? cur : roles[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesKey]);

  // 用户端不出现"SignalR / 已连接"这类技术词
  const live =
    rt === "connected"
      ? { text: "数据实时更新中", color: status.online.dot }
      : rt === "disconnected"
        ? { text: "实时更新已中断", color: status.alert.dot }
        : { text: "正在连接…", color: status.warning.dot };

  if (!role) {
    return (
      <Result
        status="info"
        title="这个账号还没有开通看护相关的功能"
        subTitle={`当前机构「${s.orgName}」下，账号 ${s.userName} 没有实时监测或告警权限。请联系机构管理员在平台上分配角色。`}
        extra={<Button onClick={logout}>退出登录</Button>}
        style={{ paddingTop: 120 }}
      />
    );
  }

  // 模块导航按权限显示
  const nav_: { key: NavKey; label: string; icon: ReactNode; show: boolean }[] = [
    { key: "home", label: "总览", icon: <AppstoreOutlined />, show: true },
    { key: "elders", label: "长者", icon: <UserOutlined />, show: hasAnyPermission(s, [...RES.monitoring]) },
    { key: "alerts", label: "告警", icon: <BellOutlined />, show: hasAnyPermission(s, [...RES.alert]) },
    { key: "health", label: "健康", icon: <HeartOutlined />, show: hasAnyPermission(s, [...RES.health]) },
  ];
  const navItems = nav_.filter((n) => n.show);

  const switchTo = (r: Role) => {
    setRole(r);
    setNav("home");
  };
  const menuItems: MenuProps["items"] = [];
  if (roles.length > 1) {
    menuItems.push(
      { key: "switch", type: "group", label: "切换视图" },
      ...roles.map((r) => ({ key: r, icon: <SwapOutlined />, label: ROLE_LABEL[r] + (r === role ? " ✓" : ""), onClick: () => switchTo(r) })),
      { type: "divider" },
    );
  }
  if (DEV_PREVIEW) {
    menuItems.push(
      { key: "dev", type: "group", label: "开发预览（安装包中不显示）" },
      ...(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({
        key: "dev-" + r,
        label: ROLE_LABEL[r] + (r === role ? " ✓" : ""),
        onClick: () => switchTo(r),
      })),
      { type: "divider" },
    );
  }
  menuItems.push({ key: "logout", label: "退出登录", icon: <LogoutOutlined />, danger: true, onClick: logout });

  const displayName = s.realName || s.nickName || s.userName;
  // 家属只关注自己的家人，不需要模块导航
  const showRail = role !== "family";
  const current = navItems.find((n) => n.key === nav) ?? navItems[0];
  const detailMember = detailId ? care.members.find((m) => m.memberId === detailId) : undefined;

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-brand">
          <img src="/logo.svg" alt="" width={24} height={24} />
          康养看护
        </div>
        {role !== "family" && <OrgPicker s={s} className="shell-org" fallback={<span className="shell-pill">{s.orgName}</span>} />}
        <span style={{ flex: 1 }} />
        <span className="shell-live">
          <i style={{ background: live.color }} />
          {live.text}
        </span>
        <Dropdown menu={{ items: menuItems }}>
          <span className="shell-user">
            <span className="avatar">{displayName.charAt(0)}</span>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, fontSize: 13 }}>
              {displayName}
              <span style={{ fontSize: 11, color: "#8A8FA8" }}>{ROLE_LABEL[role]}</span>
            </span>
            <DownOutlined style={{ fontSize: 10, color: "#8A8FA8" }} />
          </span>
        </Dropdown>
      </header>

      <div className="shell-body">
        {showRail && (
          <nav className="shell-rail" aria-label="模块">
            {navItems.map((n) => (
              <button
                key={n.key}
                className={`rail-item${n.key === current.key ? " active" : ""}`}
                onClick={() => {
                  setNav(n.key);
                  setDetailId(undefined);
                }}
              >
                {n.icon}
                {n.label}
              </button>
            ))}
          </nav>
        )}
        <main className="shell-content">
          <CareProvider value={ctx}>
            {detailMember ? (
              <div className="page">
                <ElderDetail
                  orgId={s.orgId}
                  member={detailMember}
                  live={care.liveOf(detailMember)}
                  alert={care.alertByMember[detailMember.memberId]}
                  attention={care.attention.items.find((a) => a.memberId === detailMember.memberId)}
                  now={now}
                  onBack={() => setDetailId(undefined)}
                  onProcess={alertCenter.setProcessing}
                />
              </div>
            ) : current.key === "elders" ? (
              <EldersPage />
            ) : current.key === "alerts" ? (
              <AlertsPage />
            ) : current.key === "health" ? (
              <HealthPage />
            ) : current.key === "home" && role === "care" ? (
              <CareHome />
            ) : (
              <Placeholder title={ROLE_LABEL[role]} desc={HOME_DESC[role]} />
            )}
          </CareProvider>
        </main>
      </div>
      <AlertProcessDialog
        alert={alertCenter.processing}
        now={now}
        onClose={alertCenter.closeProcessing}
        onDone={alertCenter.done}
      />
    </div>
  );
}
