import "@ant-design/v5-patch-for-react-19";
import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/es/locale/zh_CN";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import { baseTheme } from "@radar/core";
import RootApp from "./App";
import "./styles.css";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

// 主题与外壳两端共用（core 的 baseTheme / AppShell）
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={baseTheme}>
      <AntApp>
        <RootApp />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
