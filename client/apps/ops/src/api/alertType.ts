import { api } from "@radar/core";
import { orgOf } from "./master";
import { getOrgSettings, watchPushChanged, type OrgSettings } from "./orgSettings";
import type { Scene } from "./scene";

/**
 * 告警类型的机构配置（平台"告警事件类型"页的"配置"）。按机构存：同一告警类型在一个机构里只有一份，
 * 对机构里所有设备生效。接口和语音留言的说明见 docs/site-analysis.md"语音留言"。
 */

export interface AlertTypeConfig {
  alertTypeId: string;
  /** 告警时由平台配的 SIP 服务商给设备的"语音留言电话"（属性 tts-phone）打电话，播这段留言 */
  enableTtsVoiceMessage?: boolean;
  /** 最多 512 字，可用 TTS_VARIABLES 里的变量 */
  ttsVoiceMessageContent?: string;
  /** 自定义推送设置：开了以后这类告警的推送渠道（下面几项）用自己的，不再跟机构设置走 */
  enableSettings?: boolean;
  /** 推送到护工手表（平台叫"启用免陪护手表推送"），enableSettings 开着才生效 */
  enableNotifyWatch?: boolean;
  [k: string]: unknown;
}

/** 留言内容里能用的变量（平台网页端的提示） */
export const TTS_VARIABLES = [
  { token: "#DeviceName#", label: "设备名称" },
  { token: "#MemberName#", label: "人员姓名" },
  { token: "#BuildingName#", label: "楼栋名称" },
  { token: "#FloorName#", label: "楼层名称" },
  { token: "#RoomName#", label: "房间名称" },
  { token: "#BedName#", label: "床位名称" },
];
export const TTS_MAX_LENGTH = 512;

/** 设备的语音留言电话（平台属性，只存在平台，不下发设备） */
export const TTS_PHONE = "tts-phone";

/** 场景触发的告警类型：动作 Event_auto_trig 上的 alertTypeId */
export const alertTypeOf = (s?: Scene) => s?.actions?.find((a) => a.name === "Event_auto_trig" && a.alertTypeId)?.alertTypeId as string | undefined;

/** 设备所属机构的配置（不传设备 = 当前机构）；没配过时只有 alertTypeId */
export async function getAlertTypeConfig(alertTypeId: string, device?: { orgId: string }): Promise<AlertTypeConfig> {
  const res = await api.get<AlertTypeConfig>("/api/alert-type/config", { params: { alertTypeId }, org: device ? await orgOf(device) : undefined });
  return { ...res.data, alertTypeId };
}

/** 改语音留言：平台的保存是整份覆盖，先取现在的配置只改这两项（ttsVoiceMessageReceivers 平台网页端保存时也去掉） */
export async function setTtsVoiceMessage(alertTypeId: string, device: { orgId: string }, enable: boolean, content?: string) {
  const { ttsVoiceMessageReceivers: _, ...cur } = await getAlertTypeConfig(alertTypeId, device);
  await api.put("/api/alert-type/config", { ...cur, alertTypeId, enableTtsVoiceMessage: enable, ...(content !== undefined ? { ttsVoiceMessageContent: content } : {}) }, { org: await orgOf(device) });
}

/** 告警类型（平台"告警事件类型"），description 是平台上的备注 */
export interface AlertType {
  id: string;
  alertTypeName: string;
  alertTypeGroup: number;
  description?: string;
  sortOrder?: number;
}

export async function getAlertTypes(): Promise<AlertType[]> {
  return (await api.get<AlertType[]>("/api/alert-type/pages", { params: { pagination: false } })).data ?? [];
}

/** 备注带 goodlife 的是我们用的告警类型，其余是平台上别家的或旧的（李虎 65 种里 18 种） */
export const isOurAlertType = (t: AlertType) => /goodlife/i.test(t.description ?? "");

/** 这类告警单独开了推送到护工手表 */
export const watchPushOn = (c?: AlertTypeConfig) => !!(c?.enableSettings && c.enableNotifyWatch);

/**
 * enableSettings 开着时这类告警自己的推送渠道。打开时从机构设置抄过来，保证只多了手表推送、别的渠道不变；
 * 机构没设 enableNotifyOpen 时平台网页端按开启算
 */
const channelsOf = (o: OrgSettings["alertSettings"] = {}) => ({
  disableNotifyWx: !!o.disableNotifyWx,
  disableNotifyApp: !!o.disableNotifyApp,
  disableNotifyWeb: !!o.disableNotifyWeb,
  enableNotifyOpen: o.enableNotifyOpen !== false,
});

/**
 * 单独给一类告警开 / 关推送到护工手表（机构的总开关关着时用）。
 * 开：没开自定义设置时先把机构的推送渠道抄过来再打开；关：渠道和机构一致时连自定义设置一起关，恢复跟机构走
 */
export async function setWatchPush(alertTypeId: string, on: boolean, device?: { orgId: string }) {
  const org = device ? await orgOf(device) : undefined;
  const [{ ttsVoiceMessageReceivers: _, ...cur }, orgSettings] = await Promise.all([
    api.get<AlertTypeConfig>("/api/alert-type/config", { params: { alertTypeId }, org }).then((r) => r.data ?? ({} as AlertTypeConfig)),
    getOrgSettings(org),
  ]);
  const base = channelsOf(orgSettings.alertSettings);
  let next: AlertTypeConfig;
  if (on) next = { ...cur, ...(cur.enableSettings ? {} : base), alertTypeId, enableSettings: true, enableNotifyWatch: true };
  else {
    const mine = channelsOf(cur as OrgSettings["alertSettings"]);
    const same = (Object.keys(base) as (keyof typeof base)[]).every((k) => base[k] === mine[k]) && !cur.enableNotifySms;
    next = { ...cur, alertTypeId, enableNotifyWatch: false, ...(same ? { enableSettings: false } : {}) };
  }
  await api.put("/api/alert-type/config", next, { org });
  watchPushChanged();
  return next;
}
