import { api } from "@radar/core";

/**
 * 机构设置（平台 系统管理 › 系统设置 `modules__system__SettingPage`）：GET / POST /api/settings/org，按当前机构存。
 * 网页端整份表单一起提交；这里只改一项，所以先取当前整份、改这一项再整份写回，别的设置原样保留
 */
export interface OrgSettings {
  alertSettings?: {
    /** 推送告警消息到护工手表：开了雷达告警才会在护工手表上弹窗。关着时也可以在告警事件类型里单独给某类告警开 */
    enableNotifyWatch?: boolean;
    disableNotifyWx?: boolean;
    disableNotifyApp?: boolean;
    disableNotifyWeb?: boolean;
    enableNotifyOpen?: boolean;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

type Org = { orgId: string; orgType: number };

/** org 不传 = 当前机构 */
export async function getOrgSettings(org?: Org): Promise<OrgSettings> {
  return (await api.get<OrgSettings>("/api/settings/org", { org })).data ?? {};
}

/** 总开关：开了所有告警都推送到护工手表 */
export async function setNotifyWatch(enabled: boolean, org?: Org) {
  const cur = await getOrgSettings(org);
  await api.post("/api/settings/org", { ...cur, alertSettings: { ...cur.alertSettings, enableNotifyWatch: enabled } }, { org });
  watchPushChanged();
}

/**
 * 推送到护工手表在系统设置和设备的告警配置里都能改，两个页面都一直挂着，
 * 一边改了通知另一边重新读，免得显示旧的勾选
 */
const WATCH_PUSH_EVENT = "ops-watch-push-changed";
export const watchPushChanged = () => window.dispatchEvent(new Event(WATCH_PUSH_EVENT));
export function onWatchPushChanged(f: () => void) {
  window.addEventListener(WATCH_PUSH_EVENT, f);
  return () => window.removeEventListener(WATCH_PUSH_EVENT, f);
}
