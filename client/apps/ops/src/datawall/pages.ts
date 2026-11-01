import type { Session } from "@radar/core";
import { firstRoomTarget, safetyReportTarget, sleepReportTarget, type PlatformTarget } from "./platformTargets";

/**
 * 数据魔墙有哪些页面。轮播开关、显示隐藏、顺序、停留时间在"魔墙设置"里改（config.ts）。
 * rooms 是我们自己的全房间看板；platform 是临时直接显示的平台原页面，数字是平台算的，确定留下后再用自己的数据重做。
 */
export type WallPageDef = { key: string; title: string } & (
  | { kind: "rooms" }
  | {
      kind: "platform";
      /** 固定地址，或打开前由客户端挑房间、长者、日期 */
      target: PlatformTarget | (() => Promise<PlatformTarget | undefined>);
      design: { width: number; height: number };
      /** 这个页面在平台的后台框架里，要藏掉左侧菜单和顶栏 */
      hideChrome?: boolean;
    }
);

/**
 * 平台大屏的字号按窗口宽度分三档（≥1711 是 1px，1500–1710 是 0.89px，更窄 0.8px），高度不适应，窗口矮了底部就超出。
 * 所以用 webview 缩放，让页面始终看到这个尺寸。实测（2026-11-01）：地图驾驶舱 1080 高时面板都在 1060 以内；
 * 健康画像最矮要 1100（1080 时睡眠卡片超出 20 像素，再高它贴着底边跟着变高）
 */
const DESIGN_1080 = { width: 1920, height: 1080 };
const DESIGN_1100 = { width: 1920, height: 1100 };

export const WALL_PAGES: WallPageDef[] = [
  { key: "rooms", title: "全房间", kind: "rooms" },
  { key: "map", title: "地图驾驶舱", kind: "platform", target: { path: "/care/cockpit/map" }, design: DESIGN_1080 },
  { key: "portrait", title: "用户健康画像", kind: "platform", target: { path: "/care/cockpit/health-portrait" }, design: DESIGN_1100 },
  { key: "monitor", title: "实时监护", kind: "platform", target: { path: "/care/monitoring/member-panoramic" }, design: DESIGN_1080, hideChrome: true },
  { key: "room", title: "房间详情", kind: "platform", target: firstRoomTarget, design: DESIGN_1080, hideChrome: true },
  { key: "sleep", title: "睡眠报告", kind: "platform", target: sleepReportTarget, design: DESIGN_1080, hideChrome: true },
  { key: "safety", title: "安全守护报告", kind: "platform", target: safetyReportTarget, design: DESIGN_1080, hideChrome: true },
];

/**
 * 打开魔墙后隔多久开始在后台加载平台页面，每页再隔多久（一个一个来：后面的能复用前面建好的连接）。
 * 本机到平台新建连接常卡 10 秒左右（2026-11-01 实测 13 个文件 5 个卡住；接口本身约 100 毫秒，脚本约 3 MB），不提前加载就会白屏等
 */
export const PRELOAD_START_MS = 2000;
export const PRELOAD_STEP_MS = 5000;

export const platformUrl = (s: Session, path: string) => new URL(path, s.server).href;

/** 藏掉平台后台框架的左侧菜单、顶栏、面包屑和菜单占的位置（类名取自平台页面，2026-11-01 核对） */
const HIDE_CHROME = `
  var css = ".ant-pro-sider,.ant-layout-sider,.ant-pro-layout-header,header.ant-layout-header,.ant-breadcrumb,.ant-layout-has-sider>div:first-child{display:none!important}";
  document.addEventListener("DOMContentLoaded", function () {
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  });
`;

/** 把报告页要的默认信息换成我们挑的（平台用 fetch 请求，2026-11-01 核对） */
const replaceReportDefault = (report: NonNullable<PlatformTarget["report"]>) => `
  var report = ${JSON.stringify(report)}, rawFetch = window.fetch;
  window.fetch = function (input) {
    var url = String((input && input.url) || input);
    if (url.indexOf("/api/member-report/default-info") >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ succeeded: true, data: report }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return rawFetch.apply(this, arguments);
  };
`;

/**
 * 平台页面加载前跑的脚本：写入平台网页端登录后存的那些键（键名取自平台前端代码），打开就是已登录、当前机构、中文界面。
 * 只对平台域名生效，子 webview 万一跳到别的网站，登录信息不会写过去。
 */
export function platformScript(s: Session, o: { hideChrome?: boolean; report?: PlatformTarget["report"] } = {}) {
  const session: Record<string, string> = {
    SDB_TOKEN: s.token,
    SDB_USERID: s.userId,
    SDB_USER_NAME: s.userName,
    SDB_REAL_NAME: s.realName ?? "",
    SDB_NICK_NAME: s.nickName ?? "",
    SDB_ORG_ID: s.orgId,
    SDB_ORG_TYPE: String(s.orgType),
    SDB_ORG_NAME: s.orgName,
    SDB_RAW_ORG_ID: s.rawOrgId,
    SDB_SA: String(s.isSa),
    SDB_AD: String(s.isAdmin),
    SDB_MENUS: JSON.stringify(s.resources),
  };
  const local = { SDB_ORG_ID: s.orgId, SDB_ORG_TYPE: String(s.orgType), umi_locale: "zh-CN" };
  return `(function () {
  if (location.origin !== ${JSON.stringify(new URL(s.server).origin)}) return;
  var session = ${JSON.stringify(session)}, local = ${JSON.stringify(local)}, k;
  for (k in session) sessionStorage.setItem(k, session[k]);
  for (k in local) localStorage.setItem(k, local[k]);
${o.hideChrome ? HIDE_CHROME : ""}${o.report ? replaceReportDefault(o.report) : ""}})();`;
}
