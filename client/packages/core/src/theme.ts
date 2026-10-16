import type { ThemeConfig } from "antd";

/** 两端共用的品牌色与状态色（见界面稿"设计规范"画板） */
export const brand = {
  navy: "#111441",
  accent: "#556FF7",
  primary: "#3B4FD8",
  selectedBg: "#EEF1FF",
  pageBg: "#F4F5FA",
  border: "#E4E6EF",
  text: "#1B1D2E",
  textSecondary: "#5B6078",
  textMuted: "#8A8FA8",
};

export const status = {
  online: { dot: "#1F9D55", bg: "#E8F6EE", fg: "#17794A" },
  alert: { dot: "#D93036", bg: "#FDECEC", fg: "#B4232A" },
  warning: { dot: "#D97706", bg: "#FFF4E0", fg: "#9A5B00" },
  offline: { dot: "#B3B7C9", bg: "#F1F2F7", fg: "#5B6078" },
};

export const SYSTEM_FONT =
  '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", -apple-system, "PingFang SC", sans-serif';

export const baseTheme: ThemeConfig = {
  token: {
    colorPrimary: brand.primary,
    colorSuccess: status.online.dot,
    colorWarning: status.warning.dot,
    colorError: status.alert.dot,
    fontSize: 14,
    borderRadius: 6,
    // 桌面应用的控件比网页紧凑：输入框、按钮 30px（antd 默认 32px）
    controlHeight: 30,
    // Windows 系统字体：英文数字用 Segoe UI，中文用微软雅黑 UI。不用 Noto Sans SC，大多数用户电脑上没装，看到的和开发机不一样
    fontFamily: SYSTEM_FONT,
  },
  components: {
    // 页内 Tab 矮一些、字小一些，不抢页面标题
    Tabs: { titleFontSize: 13, horizontalItemPadding: "8px 0", horizontalItemGutter: 24, horizontalMargin: "0 0 12px 0" },
    Table: { cellPaddingBlock: 10, cellPaddingInline: 12, headerBg: "#F8F9FC" },
  },
};
