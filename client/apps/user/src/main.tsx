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
import "./styles.css";

// 用户端：比运维端更宽松的密度、更大的字号和圆角（界面稿"用户端"页）
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ ...baseTheme, token: { ...baseTheme.token, fontSize: 14, borderRadius: 8 } }}>
      <AntApp>
        <RootApp />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
