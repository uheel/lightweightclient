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

export const baseTheme: ThemeConfig = {
  token: {
    colorPrimary: brand.primary,
    colorSuccess: status.online.dot,
    colorWarning: status.warning.dot,
    colorError: status.alert.dot,
    borderRadius: 6,
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", -apple-system, "Segoe UI", sans-serif',
  },
};
