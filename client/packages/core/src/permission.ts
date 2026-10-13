import { md5 } from "js-md5";
import type { Session } from "./session";

/**
 * 平台的权限判断（与网页端 vendors.sdb 的 testPermission 一致）：
 * /sapi/permission/resources 返回的是 md5(`${orgId}:${userId}:${resKey}`) 列表，
 * resKey 是资源树里的菜单/操作编码，例如 MONITORING、ALERT_RADAR、SYSTEM_USER:add。
 * 超管（isSa）拥有全部权限。
 */
const cache = new WeakMap<string[], Set<string>>();

export function hasPermission(s: Session, resKey: string): boolean {
  if (s.isSa) return true;
  let set = cache.get(s.resources);
  if (!set) {
    set = new Set(s.resources);
    cache.set(s.resources, set);
  }
  return set.has(md5(`${s.orgId}:${s.userId}:${resKey}`));
}

export function hasAnyPermission(s: Session, resKeys: string[]) {
  return resKeys.some((k) => hasPermission(s, k));
}

/** 常用的资源编码（来自 /sapi/permission/resource-tree） */
export const RES = {
  /** 实时监测：房间全景、房间详情、床位全景、实时监护 */
  monitoring: ["MONITORING", "MONITORING_ROOM_PANORAMIC", "MONITORING_ROOM_VIEW", "MONITORING_BED_PANORAMIC", "MONITORING_MEMBER_PANORAMIC"],
  /** 告警记录 */
  alert: ["ALERT_RADAR", "ALERT_RADAR:view"],
  /** 健康数据 */
  health: ["HEALTH", "HEALTH_RESPIRATORY_HEART_RATE", "COCKPIT_HEALTH_PORTRAIT"],
  /** 机构管理：用户、角色管理 */
  orgAdmin: ["SYSTEM_USER", "SYSTEM_ROLE"],
} as const;
