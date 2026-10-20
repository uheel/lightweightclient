/**
 * 监控模式的配色方案（2026-10-20 定的六套，默认浅色云白）。
 * 每套是一组颜色变量：MonitorMode 把它写成 .monitor / .mon-modal 上的 CSS 变量（--m-xxx），monitor.css 只读变量；
 * tone 决定 antd 弹窗用深色还是浅色、时间回溯画布用哪套底色。
 * 告警红、提醒橙、正常绿在每套里都保留，只按底色调深浅保证对比度。
 */
export interface Scheme {
  key: string;
  name: string;
  desc: string;
  tone: "dark" | "light";
  c: {
    bg: string;
    head: string;
    headText: string;
    headMuted: string;
    panel: string;
    card: string;
    cardDim: string;
    border: string;
    border2: string;
    borderHover: string;
    hover: string;
    text: string;
    text2: string;
    muted: string;
    faint: string;
    accent: string;
    accentBg: string;
    accentText: string;
    link: string;
    ok: string;
    okBg: string;
    alert: string;
    alertBg: string;
    alertBg2: string;
    alertBorder: string;
    alertText: string;
    warn: string;
    warnBg: string;
    warnBorder: string;
    warnText: string;
    plan: string;
    planGrid: string;
    planWall: string;
    planLine: string;
    tagBg: string;
  };
}

export const SCHEMES: Scheme[] = [
  {
    key: "navy",
    name: "深海蓝",
    desc: "品牌深蓝，和设计稿一致",
    tone: "dark",
    c: {
      bg: "#0A0E27", head: "#0E1336", headText: "#E6E8F5", headMuted: "#8E95BF",
      panel: "#0F1436", card: "#121842", cardDim: "#0D1130",
      border: "#1F2652", border2: "#2D3570", borderHover: "#4A55A0", hover: "#161D4F",
      text: "#E6E8F5", text2: "#C9CDE6", muted: "#8E95BF", faint: "#5A6196",
      accent: "#7B8CFF", accentBg: "#232B6B", accentText: "#AEB8FF", link: "#9DAAFF",
      ok: "#5BD68C", okBg: "#10331F",
      alert: "#E5484D", alertBg: "#3A0F18", alertBg2: "#5A1420", alertBorder: "#8A2433", alertText: "#FF8A93",
      warn: "#B7791F", warnBg: "#2E2209", warnBorder: "#6B4A12", warnText: "#FFC266",
      plan: "#121842", planGrid: "#1A2150", planWall: "#5A64A8", planLine: "#3A4380", tagBg: "rgba(10,14,39,.85)",
    },
  },
  {
    key: "graphite",
    name: "石墨",
    desc: "中性深灰，不偏色，看久了不累",
    tone: "dark",
    c: {
      bg: "#111214", head: "#151618", headText: "#E8E9EB", headMuted: "#9A9DA4",
      panel: "#18191C", card: "#1F2024", cardDim: "#151619",
      border: "#2C2E33", border2: "#3A3D44", borderHover: "#565A63", hover: "#26282D",
      text: "#E8E9EB", text2: "#C9CBD0", muted: "#9A9DA4", faint: "#62666E",
      accent: "#5AA9FF", accentBg: "#1D3350", accentText: "#9CCBFF", link: "#7DBBFF",
      ok: "#4ADE80", okBg: "#12301E",
      alert: "#E5484D", alertBg: "#3B1517", alertBg2: "#55201F", alertBorder: "#7F2A2E", alertText: "#FF8787",
      warn: "#B7791F", warnBg: "#33260F", warnBorder: "#6E5218", warnText: "#F5C26B",
      plan: "#1B1C1F", planGrid: "#25272B", planWall: "#6B7079", planLine: "#41444B", tagBg: "rgba(17,18,20,.85)",
    },
  },
  {
    key: "night",
    name: "夜间值守",
    desc: "暖黑低亮度，夜里不刺眼",
    tone: "dark",
    c: {
      bg: "#0D0C0A", head: "#11100D", headText: "#CFC7BA", headMuted: "#8A8174",
      panel: "#14120F", card: "#1B1814", cardDim: "#12100D",
      border: "#2A251E", border2: "#3A3329", borderHover: "#5A4F40", hover: "#221E18",
      text: "#CFC7BA", text2: "#B5AD9F", muted: "#8A8174", faint: "#5C554B",
      accent: "#D9A55B", accentBg: "#3A2C17", accentText: "#E6C38F", link: "#E0B270",
      ok: "#8DBF7A", okBg: "#1C2A16",
      alert: "#C8473A", alertBg: "#3A1410", alertBg2: "#4E1C15", alertBorder: "#7A2A20", alertText: "#F08A72",
      warn: "#A67A2A", warnBg: "#2E2410", warnBorder: "#5E4A1E", warnText: "#E8C37A",
      plan: "#171511", planGrid: "#211D18", planWall: "#6E6252", planLine: "#3E362C", tagBg: "rgba(13,12,10,.85)",
    },
  },
  {
    key: "contrast",
    name: "高对比",
    desc: "纯黑亮色，投影和远处电视看得清",
    tone: "dark",
    c: {
      bg: "#000000", head: "#000000", headText: "#FFFFFF", headMuted: "#BDBDBD",
      panel: "#0A0A0A", card: "#121212", cardDim: "#080808",
      border: "#3A3A3A", border2: "#555555", borderHover: "#8A8A8A", hover: "#1E1E1E",
      text: "#FFFFFF", text2: "#E6E6E6", muted: "#BDBDBD", faint: "#8A8A8A",
      accent: "#4FC3FF", accentBg: "#0B3550", accentText: "#9EDFFF", link: "#6FD0FF",
      ok: "#00E676", okBg: "#00331A",
      alert: "#FF3B4E", alertBg: "#4A0008", alertBg2: "#6E000E", alertBorder: "#FF3B4E", alertText: "#FF7A85",
      warn: "#E6A100", warnBg: "#3D2B00", warnBorder: "#FFB300", warnText: "#FFD15C",
      plan: "#0E0E0E", planGrid: "#1C1C1C", planWall: "#BDBDBD", planLine: "#555555", tagBg: "rgba(0,0,0,.88)",
    },
  },
  {
    key: "cloud",
    name: "浅色 · 云白",
    desc: "品牌浅色，和主界面一致，白天办公室",
    tone: "light",
    c: {
      bg: "#F4F5FA", head: "#111441", headText: "#E6E8F5", headMuted: "#AEB2CE",
      panel: "#FFFFFF", card: "#FFFFFF", cardDim: "#F1F2F7",
      border: "#E4E6EF", border2: "#D5D8E6", borderHover: "#9AA2D8", hover: "#F1F3FE",
      text: "#1B1D2E", text2: "#3D4158", muted: "#5B6078", faint: "#8A8FA8",
      accent: "#3B4FD8", accentBg: "#EEF1FF", accentText: "#26339A", link: "#3B4FD8",
      ok: "#1F9D55", okBg: "#E8F6EE",
      alert: "#D93036", alertBg: "#FDECEC", alertBg2: "#F9D4D5", alertBorder: "#F3B5B8", alertText: "#B4232A",
      warn: "#C2740A", warnBg: "#FFF4E0", warnBorder: "#F0D29A", warnText: "#9A5B00",
      plan: "#FAFBFD", planGrid: "#EEF0F5", planWall: "#1B1D2E", planLine: "#B3B7C9", tagBg: "rgba(255,255,255,.92)",
    },
  },
  {
    key: "paper",
    name: "浅色 · 暖纸",
    desc: "米白偏暖，护士站白天光线亮",
    tone: "light",
    c: {
      bg: "#F5F2EC", head: "#EDE8DF", headText: "#2B2620", headMuted: "#6E665B",
      panel: "#FBF9F5", card: "#FFFFFF", cardDim: "#F2EEE7",
      border: "#E3DDD2", border2: "#D6CEC0", borderHover: "#A89C88", hover: "#F3EEE5",
      text: "#2B2620", text2: "#4A433A", muted: "#6E665B", faint: "#9A9184",
      accent: "#2F6F73", accentBg: "#E3F0F0", accentText: "#1F5155", link: "#2F6F73",
      ok: "#2E7D4F", okBg: "#E4F2E9",
      alert: "#C2412D", alertBg: "#FBE9E6", alertBg2: "#F6D3CC", alertBorder: "#E9B4AA", alertText: "#A8321F",
      warn: "#B8770F", warnBg: "#FCF1DD", warnBorder: "#E8CD94", warnText: "#8A5A0B",
      plan: "#FFFFFF", planGrid: "#F0EBE2", planWall: "#2B2620", planLine: "#C9BFAF", tagBg: "rgba(255,255,255,.92)",
    },
  },
];

export const DEFAULT_SCHEME = "cloud";
const KEY = "RC_MONITOR_SCHEME";

export function savedScheme(): Scheme {
  let k: string | null = null;
  try {
    k = localStorage.getItem(KEY);
  } catch {
    /* 读不到就用默认 */
  }
  return SCHEMES.find((s) => s.key === k) ?? SCHEMES.find((s) => s.key === DEFAULT_SCHEME)!;
}

export function saveScheme(key: string) {
  try {
    localStorage.setItem(KEY, key);
  } catch {
    /* 存不了就只在本次生效 */
  }
}

/** 写成 CSS：.monitor 和弹窗（.mon-modal 在 body 下）都要有这些变量 */
export function schemeCss(s: Scheme) {
  const vars = Object.entries(s.c)
    .map(([k, v]) => `--m-${k.replace(/[A-Z0-9]/g, (m) => `-${m.toLowerCase()}`)}:${v};`)
    .join("");
  return `.monitor,.mon-modal{${vars}}`;
}

/** 时间回溯画布的颜色（深色方案用；浅色方案用回溯自己的浅色） */
export function replayPalette(s: Scheme) {
  const c = s.c;
  return {
    text: c.text, muted: c.muted, line: c.border2, lane: c.hover, run: c.border2, primary: c.accent, density: c.accent, overview: c.borderHover, head: c.alert,
    roomBg: c.plan, roomGrid: c.planGrid, zoneText: c.text2, roomStroke: c.planWall, elText: c.text2, tlGrid: c.planGrid, hover: c.muted,
  };
}
