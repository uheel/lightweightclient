import "@ant-design/v5-patch-for-react-19";
import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/es/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

dayjs.locale("zh-cn");
import { baseTheme } from "@radar/core";
import RootApp from "./App";
import AlertPopup from "./desktop/AlertPopup";
import "./styles.css";

/** 同一份页面也给告警弹窗窗口用（src-tauri/src/lib.rs 用 index.html#alert-popup 打开） */
const isPopup = location.hash === "#alert-popup";

// 主题与外壳两端共用（core 的 baseTheme / AppShell）
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={baseTheme}>
      <AntApp>
        {isPopup ? <AlertPopup /> : <RootApp />}
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
