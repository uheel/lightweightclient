import { api } from "@radar/core";

/** 护理值守用到的平台接口（与网页端"实时监护"页面一致，只读） */

export interface MemberDevice {
  deviceId: string;
  sn: string;
  /** 设备类型：6 AIO，12 Ultra 呼吸睡眠，13 UltraFall，15 Ultra Plus …（决定睡眠报告来源） */
  deviceType?: number;
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

export interface AlertRecord extends CareAlert {
  alertProcessTypeName?: string;
  processingResults?: string;
  processByUserName?: string;
  processAt?: string;
}

/** 用户端可见的告警分组（离线、安装姿态属于运维，不出现） */
export const ALERT_GROUPS = [
  { value: 2, label: "事件告警" },
  { value: 1, label: "场景告警" },
  { value: 4, label: "紧急求助" },
];

/** 告警分页查询（服务端分页，按时间倒序）。时间范围格式 "YYYY-MM-DD HH:mm:ss,YYYY-MM-DD HH:mm:ss" */
export async function getAlertPage(q: { group: number; status?: 1 | 2; range?: [string, string]; current: number; pageSize: number }) {
  const res = await api.get<AlertRecord[]>("/api/alert/pages", {
    params: { current: q.current, pageSize: q.pageSize },
    filter: { alertTypeGroup: q.group, alertStatus: q.status, createdAt: q.range ? q.range.join(",") : undefined },
  });
  return { list: res.data ?? [], total: res.total ?? 0 };
}

/** 长者的楼栋 / 楼层 / 房间（长者档案；实时监护列表里没有这些字段）。用来按护理区汇总 */
export interface MemberPlace {
  id: string;
  buildingName?: string;
  floorName?: string;
  roomName?: string;
  bedName?: string;
  /** 入住日期 */
  checkInAt?: string;
}

export async function getMemberPlaces() {
  const res = await api.get<MemberPlace[]>("/api/member/pages", { params: { current: 1, pageSize: 1000 } });
  return res.data ?? [];
}

/** 一段时间内用户端可见的全部告警（三个分组合并，按时间倒序；最多各取 5000 条） */
export async function getAlertsInRange(range: [string, string]) {
  const PAGE = 1000;
  const lists = await Promise.all(
    ALERT_GROUPS.map(async (g) => {
      const out: AlertRecord[] = [];
      for (let current = 1; current <= 5; current++) {
        const r = await getAlertPage({ group: g.value, range, current, pageSize: PAGE });
        out.push(...r.list);
        if (out.length >= r.total || r.list.length < PAGE) break;
      }
      return out;
    }),
  );
  return lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
