import type { ReactNode } from "react";
import { Badge, Dropdown, type MenuProps } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { WindowControls } from "./WindowControls";
import { useUpdater } from "./UpdateMenu";
import "./AppShell.css";

export interface ShellNavItem<K extends string> {
  key: K;
  label: string;
  icon: ReactNode;
  badge?: number;
}

/**
 * 两个客户端共用的外壳：40px 白色标题栏（兼作窗口标题栏，可拖动；关掉系统标题栏时右侧带窗口按钮） + 60px 白色模块栏 + 内容区。
 * 外观只在这里改，保证用户端和运维端一致。
 */
export function AppShell<K extends string>({
  appName,
  org,
  live,
  user,
  nav,
  active,
  onNav,
  railFooter,
  children,
}: {
  appName: string;
  /** 标题栏左侧的机构选择 */
  org?: ReactNode;
  /** 实时状态：文字和圆点颜色 */
  live: { text: string; color: string; title?: string };
  user: { name: string; sub?: string; menu: MenuProps["items"] };
  /** 不传则不显示模块栏 */
  nav?: ShellNavItem<K>[];
  active?: K;
  onNav?: (key: K) => void;
  /** 模块栏底部的额外入口（自己带 margin-top: auto 贴底） */
  railFooter?: ReactNode;
  children: ReactNode;
}) {
  // 版本号和检查更新统一加在用户菜单里（放在"退出登录"之前），两个客户端不用各自处理
  const updater = useUpdater();
  const items = [...(user.menu ?? [])];
  const at = items.findIndex((i) => i?.key === "logout");
  items.splice(at < 0 ? items.length : at, 0, ...(updater.menu ?? []), { type: "divider" });
  const menu = updater.menu?.length ? items : user.menu;

  return (
    <div className="shell">
      <header className="shell-header" data-tauri-drag-region>
        <div className="shell-brand" data-tauri-drag-region>
          <img src="/logo.svg" alt="" width={24} height={24} />
          {appName}
        </div>
        {org}
        <span style={{ flex: 1, alignSelf: "stretch" }} data-tauri-drag-region />
        <span className="shell-live" title={live.title}>
          <i style={{ background: live.color }} />
          {live.text}
        </span>
        <Dropdown menu={{ items: menu }}>
          <span className="shell-user" title={updater.hasUpdate ? "有新版本可以更新" : undefined}>
            <Badge dot={updater.hasUpdate} offset={[-2, 2]}>
              <span className="avatar">{user.name.charAt(0)}</span>
            </Badge>
            <span className="shell-user-name">
              {user.name}
              {user.sub && <small>{user.sub}</small>}
            </span>
            <DownOutlined style={{ fontSize: 10, color: "#8A8FA8" }} />
          </span>
        </Dropdown>
        <WindowControls />
      </header>
      <div className="shell-body">
        {nav && (
          <nav className="shell-rail" aria-label="模块">
            {nav.map((n) => (
              <button key={n.key} className={`rail-item${n.key === active ? " active" : ""}`} onClick={() => onNav?.(n.key)}>
                <Badge count={n.badge} size="small" offset={[4, 0]}>
                  {n.icon}
                </Badge>
                {n.label}
              </button>
            ))}
            {railFooter}
          </nav>
        )}
        <main className="shell-content">{children}</main>
      </div>
      {updater.dialog}
    </div>
  );
}
