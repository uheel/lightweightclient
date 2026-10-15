import "@ant-design/v5-patch-for-react-19";
import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/es/locale/zh_CN";
import "dayjs/locale/zh-cn";
import { baseTheme, brand } from "@radar/core";
import RootApp from "./App";
import "./styles.css";

// 运维端：深蓝侧栏、紧凑密度（界面稿"设备工作台"）
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        ...baseTheme,
        components: {
          Layout: { siderBg: brand.navy, headerBg: "#fff", headerHeight: 56, headerPadding: "0 16px" },
          Menu: { darkItemBg: brand.navy, darkSubMenuItemBg: "#282c52", darkItemSelectedBg: brand.accent },
        },
      }}
    >
      <AntApp>
        <RootApp />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
