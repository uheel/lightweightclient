import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { listen } from "@tauri-apps/api/event";
import { hidePopup, popupAction, showPopup, type PopupState } from "../alertPopup";
import "./AlertPopup.css";

/** 弹窗里最多列几条，其余的只显示数量 */
const MAX_ITEMS = 3;

/** 多久以前：刚刚 / 5 分钟前 / 2 小时 10 分前；超过一天显示日期时间 */
function sinceText(time: string, now: number) {
  const t = Date.parse(time.replace(" ", "T"));
  if (Number.isNaN(t)) return time;
  const min = Math.max(0, (now - t) / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${Math.round(min)} 分钟前`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h} 小时 ${m} 分前` : `${h} 小时前`;
  }
  return time.slice(5, 16);
}

/**
 * 告警弹窗页面（运行在单独的 alert-popup 窗口里，见 packages/core/rust/alert_popup.rs），用户端、运维端共用。
 * 不请求平台接口、不登录：显示什么、什么时候显示，全听主窗口推过来的 PopupState。
 * 窗口大小跟着内容走：量出卡片高度后交给 Rust 摆到屏幕右下角。
 */
export function AlertPopup({ appName }: { appName: string }) {
  const [state, setState] = useState<PopupState>({ alerts: [], visible: false });
  const [now, setNow] = useState(Date.now());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("popup-root");
    // 主窗口每次焦点变化、列表刷新都会推一次；内容没变就不动，免得重复摆位置
    let last = "";
    const off = listen<PopupState>("popup:state", (e) => {
      const key = JSON.stringify(e.payload);
      if (key === last) return;
      last = key;
      setState(e.payload);
      setNow(Date.now());
    });
    // 主窗口可能比弹窗先加载好，告诉它补发一次当前状态
    off.then(() => popupAction("ready"));
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      off.then((f) => f());
      window.clearInterval(t);
    };
  }, []);

  // 内容变了就重新量高度、摆位置；没有要显示的就藏起来
  useLayoutEffect(() => {
    if (!state.visible || !state.alerts.length) return void hidePopup();
    const el = box.current;
    if (!el) return;
    const place = () => showPopup(Math.ceil(el.getBoundingClientRect().height) + 2 * 10);
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  const { alerts } = state;
  const more = alerts.length - MAX_ITEMS;

  return (
    <div className="popup" ref={box}>
      <div className="popup-head">
        <i className="popup-dot" />
        <b>{alerts.length > 1 ? `${alerts.length} 条告警待处理` : "新告警"}</b>
        <span className="popup-app">{appName}</span>
        <button className="popup-close" title="稍后提醒" onClick={() => popupAction("snooze")}>
          <CloseOutlined />
        </button>
      </div>
      <ul className="popup-list">
        {alerts.slice(0, MAX_ITEMS).map((a) => (
          <li key={a.id} onClick={() => popupAction("open", a.id)}>
            <div className="popup-top">
              <b>{a.type}</b>
              <span>{sinceText(a.createdAt, now)}</span>
            </div>
            {a.who && <div className="popup-who">{a.who}</div>}
            <div className="popup-where">{a.where}</div>
          </li>
        ))}
      </ul>
      {more > 0 && <div className="popup-more">还有 {more} 条，打开客户端查看</div>}
      <div className="popup-foot">
        <Button size="small" type="text" onClick={() => popupAction("snooze")}>
          稍后提醒
        </Button>
        <Button size="small" type="primary" danger onClick={() => popupAction("open", alerts[0]?.id)}>
          去处理
        </Button>
      </div>
    </div>
  );
}
