import "@ant-design/v5-patch-for-react-19";
import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/es/locale/zh_CN";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import { AlertPopup, baseTheme, isPopupWindow } from "@radar/core";
import RootApp from "./App";
import "./styles.css";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

// tauri.conf 关了窗口的文件拖放（否则 Windows 上页面内拖动排序收不到事件），
// 拖进来的文件不让 WebView 直接打开
for (const t of ["dragover", "drop"] as const)
  window.addEventListener(t, (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });

// 主题与外壳两端共用（core 的 baseTheme / AppShell）
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={baseTheme}>
      <AntApp>
        {/* 同一份页面也给告警弹窗窗口用（packages/core/rust/alert_popup.rs 用 index.html#alert-popup 打开） */}
        {isPopupWindow ? <AlertPopup appName="Radar Config" /> : <RootApp />}
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
