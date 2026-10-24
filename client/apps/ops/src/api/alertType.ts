import { api } from "@radar/core";
import { orgOf } from "./master";
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

/** 设备所属机构的配置；没配过时只有 alertTypeId */
export async function getAlertTypeConfig(alertTypeId: string, device: { orgId: string }): Promise<AlertTypeConfig> {
  const res = await api.get<AlertTypeConfig>("/api/alert-type/config", { params: { alertTypeId }, org: await orgOf(device) });
  return { ...res.data, alertTypeId };
}

/** 改语音留言：平台的保存是整份覆盖，先取现在的配置只改这两项（ttsVoiceMessageReceivers 平台网页端保存时也去掉） */
export async function setTtsVoiceMessage(alertTypeId: string, device: { orgId: string }, enable: boolean, content?: string) {
  const { ttsVoiceMessageReceivers: _, ...cur } = await getAlertTypeConfig(alertTypeId, device);
  await api.put("/api/alert-type/config", { ...cur, alertTypeId, enableTtsVoiceMessage: enable, ...(content !== undefined ? { ttsVoiceMessageContent: content } : {}) }, { org: await orgOf(device) });
}
