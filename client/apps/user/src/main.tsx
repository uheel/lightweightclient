import "@ant-design/v5-patch-for-react-19";
import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/es/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

dayjs.locale("zh-cn");
import { AlertPopup, baseTheme, isPopupWindow } from "@radar/core";
import RootApp from "./App";
import "./styles.css";

// 主题与外壳两端共用（core 的 baseTheme / AppShell）
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={baseTheme}>
      <AntApp>
        {/* 同一份页面也给告警弹窗窗口用（packages/core/rust/alert_popup.rs 用 index.html#alert-popup 打开） */}
        {isPopupWindow ? <AlertPopup appName="Health Guardian" /> : <RootApp />}
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
