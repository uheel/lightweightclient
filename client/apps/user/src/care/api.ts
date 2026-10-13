import { api } from "@radar/core";

/** 护理值守用到的平台接口（与网页端"实时监护"页面一致，只读） */

export interface MemberDevice {
  deviceId: string;
  sn: string;
  isOnline?: boolean;
  /** 设备监测的区域，例如"房间""卫生间" */
  rangeName?: string;
}

export interface Member {
  memberId: string;
  realName: string;
  age?: number;
  /** 1 男，2 女 */
  gender?: number;
  bedName?: string;
  /** 1 = 已设为重点关注 */
  focusLevel?: number;
  devices?: MemberDevice[];
}

/** 当前机构下已绑定床位的长者（实时监护页的数据源） */
export async function getMembers() {
  const res = await api.get<Member[]>("/api/room/member-panoramic", { params: { pageSize: 500, pageIndex: 0 } });
  return res.data ?? [];
}

export interface CareAlert {
  id: string;
  alertTypeName: string;
  alertTypeColor?: string;
  /** 1 未处理，2 已处理 */
  alertStatus: number;
  buildingName?: string;
  floorName?: string;
  roomName?: string;
  createdAt: string;
  members?: { memberId: string; realName: string; age?: number; gender?: number }[];
}

/**
 * 用户端只关心需要人去处理的告警：1 场景（烟感、水浸…）、2 事件（跌倒、离床…）、4 紧急求助。
 * 3 设备离线、5 安装姿态属于运维，不在用户端出现。
 */
const CARE_ALERT_GROUPS = [1, 2, 4];

export async function getPendingAlerts(limit = 30) {
  const results = await Promise.all(
    CARE_ALERT_GROUPS.map((g) =>
      api.get<CareAlert[]>("/api/alert/pages", {
        params: { current: 1, pageSize: limit },
        filter: { alertTypeGroup: g, alertStatus: 1 },
      }),
    ),
  );
  const total = results.reduce((n, r) => n + (r.total ?? 0), 0);
  const list = results
    .flatMap((r) => r.data ?? [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  return { list, total };
}

export interface AttentionItem {
  memberId: string;
  realName?: string;
  buildingName?: string;
  floorName?: string;
  roomName?: string;
  bedName?: string;
  attentionConclusion?: string;
  /** pendingFall / effectiveFall / nightFallRisk / lowSleepScore / shortSleep / frequentLeaveBed / highAhi */
  attentionReasons?: string[];
}

export const ATTENTION_REASON: Record<string, string> = {
  pendingFall: "跌倒告警未处理",
  effectiveFall: "发生过跌倒",
  nightFallRisk: "夜间跌倒风险高",
  lowSleepScore: "睡眠评分过低",
  shortSleep: "睡眠时长过短",
  frequentLeaveBed: "频繁起夜",
  highAhi: "呼吸紊乱指数偏高",
};

/** 今日需关注名单（根据昨夜监测和告警判定，来自健康驾驶舱） */
export async function getAttention(limit = 10) {
  const res = await api.get<{ total: number; items: AttentionItem[] }>("/api/cockpit/elder/attention", { params: { limit } });
  return res.data ?? { total: 0, items: [] };
}

export interface Option {
  label: string;
  value: string;
}

/** 处理类型（各机构在"告警处理类型"里自定义，例如：有效告警 / 家属走动 / 误报 / 其他） */
export async function getProcessTypes() {
  return (await api.get<Option[]>("/api/alert-process-type/options")).data ?? [];
}

/** 告警详情 */
export async function getAlert(id: string) {
  return (await api.get<CareAlert>("/api/alert", { params: { id } })).data;
}

/**
 * 处理告警（写操作，与网页端"处理告警"弹窗提交的内容一致）。
 * 处理后告警变为已处理（alertStatus = 2），平台会记录处理人和时间。
 */
export async function processAlert(id: string, alertProcessTypeId: string, processingResults: string) {
  await api.put("/api/alert/process", { id, alertProcessTypeId, processingResults });
}
