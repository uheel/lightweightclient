import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge, Dropdown } from "antd";
import { AppstoreOutlined, CloseOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import type { NavKey } from "../guide/steps";
import { MODULES } from "./modules";
import { useNames } from "./names";

export type TabKey = NavKey | "home";

/**
 * 标题栏里的标签：第一个固定是工作台（关不掉），后面是打开的模块。
 * 中键关闭，右键菜单关闭其他 / 右侧 / 全部，可以拖动排序。标签栏的空白处仍可拖动窗口。
 */
export function WorkTabs({
  tabs,
  active,
  badges,
  onSelect,
  onClose,
  onReorder,
}: {
  tabs: NavKey[];
  active: TabKey;
  badges?: Partial<Record<NavKey, number>>;
  onSelect: (k: TabKey) => void;
  /** 一次关掉一个或多个 */
  onClose: (keys: NavKey[]) => void;
  onReorder: (tabs: NavKey[]) => void;
}) {
  const dragging = useRef<NavKey | undefined>(undefined);
  const names = useNames();

  // 标签多了不挤压：宽度不变，放不下时出现左右箭头滚动（工作台不参与滚动）
  const scroller = useRef<HTMLDivElement>(null);
  const [{ over, canLeft, canRight }, setScroll] = useState({
    over: false,
    canLeft: false,
    canRight: false,
  });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = {
      over: max > 1,
      canLeft: el.scrollLeft > 1,
      canRight: el.scrollLeft < max - 1,
    };
    setScroll((s) => (s.over === next.over && s.canLeft === next.canLeft && s.canRight === next.canRight ? s : next));
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  useLayoutEffect(measure, [tabs, names, measure]);
  // 切到的标签滚到看得见（只滚标签条，不用 scrollIntoView，免得连标题栏一起滚）
  useEffect(() => {
    const el = scroller.current;
    const tab = el?.querySelector<HTMLElement>(".work-tab.active");
    if (!el || !tab) return;
    const left = tab.offsetLeft;
    if (left < el.scrollLeft) el.scrollTo({ left, behavior: "smooth" });
    else if (left + tab.offsetWidth > el.scrollLeft + el.clientWidth)
      el.scrollTo({
        left: left + tab.offsetWidth - el.clientWidth,
        behavior: "smooth",
      });
  }, [active, tabs]);
  const scrollBy = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el)
      el.scrollBy({
        left: dir * Math.max(120, el.clientWidth * 0.7),
        behavior: "smooth",
      });
  };

  function menu(k: NavKey) {
    const i = tabs.indexOf(k);
    return {
      items: [
        { key: "close", label: "关闭" },
        { key: "others", label: "关闭其他标签", disabled: tabs.length < 2 },
        {
          key: "right",
          label: "关闭右侧标签",
          disabled: i === tabs.length - 1,
        },
        { type: "divider" as const },
        { key: "all", label: "全部关闭" },
      ],
      onClick: ({ key }: { key: string }) =>
        onClose(key === "close" ? [k] : key === "others" ? tabs.filter((t) => t !== k) : key === "right" ? tabs.slice(i + 1) : tabs),
    };
  }

  return (
    <nav className="work-tabs" aria-label="已打开的页面" data-tauri-drag-region>
      <button className={`work-tab home${active === "home" ? " active" : ""}`} onClick={() => onSelect("home")} title="工作台（Ctrl+1）">
        <AppstoreOutlined />
        <span className="work-tab-name">工作台</span>
      </button>
      {over && (
        <button className="work-tabs-arrow" disabled={!canLeft} onClick={() => scrollBy(-1)} title="向左滚动">
          <LeftOutlined />
        </button>
      )}
      <div className="work-tabs-scroll" ref={scroller} onScroll={measure} onWheel={(e) => e.deltaY && scroller.current?.scrollBy({ left: e.deltaY })}>
        {tabs.map((k) => {
          const m = MODULES[k];
          return (
            <Dropdown key={k} trigger={["contextMenu"]} menu={menu(k)}>
              <div
                className={`work-tab${active === k ? " active" : ""}`}
                role="button"
                title={names.module(k)}
                draggable
                onClick={() => onSelect(k)}
                onAuxClick={(e) => e.button === 1 && onClose([k])}
                onDragStart={(e) => {
                  dragging.current = k;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => (dragging.current = undefined)}
                onDragOver={(e) => {
                  const from = dragging.current;
                  if (!from || from === k) return;
                  e.preventDefault();
                  const next = tabs.filter((t) => t !== from);
                  next.splice(tabs.indexOf(k), 0, from);
                  onReorder(next);
                }}
              >
                {m.icon}
                <span className="work-tab-name">{names.module(k)}</span>
                {!!badges?.[k] && active !== k && <Badge count={badges[k]} size="small" />}
                <span
                  className="work-tab-close"
                  title="关闭（Ctrl+W）"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose([k]);
                  }}
                >
                  <CloseOutlined />
                </span>
              </div>
            </Dropdown>
          );
        })}
      </div>
      {over && (
        <button className="work-tabs-arrow" disabled={!canRight} onClick={() => scrollBy(1)} title="向右滚动">
          <RightOutlined />
        </button>
      )}
      <span className="work-tabs-fill" data-tauri-drag-region />
    </nav>
  );
}
