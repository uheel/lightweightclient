import { useEffect, useMemo } from "react";
import { Button, Spin } from "antd";
import { CheckCircleFilled, RightOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { Session } from "@radar/core";
import { useGuide } from "../guide/GuideContext";
import { MODULES, type ModuleKey } from "./modules";
import { isLink, linkUrl, useNames, type ItemKey } from "./names";
import { ItemIcon, itemStyle } from "./icons";
/**
 * 登录后的工作台：按工作类型分组的模块方块，右侧是快速开始里还没完成的事。
 * 数字都来自快速开始的检查结果（楼栋、房间、雷达），工作台自己不请求平台。
 */
export function Workbench({ s, unread, onOpen }: { s: Session; unread: number; onOpen: (k: ItemKey) => void }) {
  const g = useGuide();
  const d = g?.data;
  const names = useNames();

  // 快速开始全部完成的机构进来时不检查，工作台的数字就没有：补一次（只取楼栋和雷达列表，大机构不做逐台检查）
  useEffect(() => {
    if (g && !g.data && !g.loading) g.refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo<Partial<Record<ModuleKey, string>>>(() => {
    if (!d) return {};
    const radars = d.radars.filter((x) => !x.isDisabled);
    const unbound = radars.filter((x) => !x.roomId).length;
    return {
      devices: `${radars.length} 台雷达${unbound ? ` · ${unbound} 台未绑房间` : ""}`,
      spaces: `${d.buildings.length} 栋 · ${d.rooms.length} 间房 · ${d.beds.length} 张床`,
      rooms: `${d.rooms.length} 间房`,
    };
  }, [d]);
  const flags: Partial<Record<ModuleKey, string>> = unread ? { realtime: `${unread > 99 ? "99+" : unread} 条新` } : {};

  const todo = (g?.steps ?? []).filter((x) => x.status === "todo" || x.status === "doing");
  const hour = dayjs().hour();
  const hello = hour < 6 ? "夜深了" : hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";

  return (
    <div className="desk">
      <div className="desk-main">
        <div className="desk-hello">
          <h1>
            {hello}，{s.realName || s.nickName || s.userName}
          </h1>
          <span className="muted">
            {s.orgName} · {dayjs().format("M 月 D 日 dddd")}
          </span>
        </div>
        {names.desk.map((grp) => (
          <section key={grp.key} className="desk-group">
            <h2>{names.group(grp.key)}</h2>
            <div className="desk-tiles">
              {grp.keys.map((k) => {
                const m = itemStyle(k);
                // 链接模块不写说明（网址也不显示），只在没填好网址时提醒
                const desc = isLink(k) ? (linkUrl(names.link(k)?.url) ? undefined : "还没填网址") : (stats[k] ?? MODULES[k].desc);
                return (
                  <button key={k} className={`desk-tile${k === "monitor" ? " dark wide" : ""}`} onClick={() => onOpen(k)}>
                    <span className="desk-tile-icon" style={{ background: m.tint, color: m.color }}>
                      <ItemIcon k={k} />
                    </span>
                    <b>{names.module(k)}</b>
                    {desc && <small>{desc}</small>}
                    {!isLink(k) && flags[k] && <span className="desk-flag">{flags[k]}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <aside className="desk-side">
        <h2>需要处理</h2>
        <div className="desk-todo">
          {!g?.steps.length ? (
            <div className="desk-todo-empty">{g?.loading ? <Spin size="small" /> : g?.error ? `检查失败：${g.error}` : "还没有检查结果"}</div>
          ) : todo.length ? (
            todo.map((x) => (
              <button key={x.key} onClick={() => g.go(x.action.target)}>
                <span className={`dot ${x.status === "doing" ? "doing" : "todo"}`} />
                <span className="desk-todo-text">
                  <b>{x.title}</b>
                  <small>{x.summary}</small>
                </span>
                <RightOutlined className="muted" />
              </button>
            ))
          ) : (
            <div className="desk-todo-empty">
              <CheckCircleFilled style={{ color: "#1F9D55" }} /> 配置都已完成
            </div>
          )}
        </div>
        {!!g?.steps.length && (
          <Button type="link" size="small" onClick={() => g.setOpen(true)} style={{ padding: 0 }}>
            打开快速开始清单
          </Button>
        )}
      </aside>
    </div>
  );
}
