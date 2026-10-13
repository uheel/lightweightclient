import { hasAnyPermission, RES, type Session } from "@radar/core";

/** 用户端按角色进入不同首页 */
export type Role = "care" | "family" | "manager";

export const ROLE_LABEL: Record<Role, string> = {
  care: "护理值守",
  family: "家属",
  manager: "机构管理者",
};

/**
 * 根据账号的权限能力（而不是角色名称）判断可用的视图。
 * 平台上角色名由各机构自定义（"护工""救助站一楼""操作员"…），没有统一编码，
 * 但护理类账号都有"实时监测 / 告警记录"，管理者有 isAdmin 或用户、角色管理权限。
 *
 * - manager：超管、机构管理员（isAdmin），或有用户 / 角色管理权限
 * - care：有实时监测或告警记录权限
 * - family：平台上没有家属类账号（家属走手机 App / 小程序的账号体系），暂不自动识别
 *
 * 返回顺序即默认优先级：管理者默认进概览，也可以切到值守视图。
 */
export function availableRoles(s: Session): Role[] {
  const roles: Role[] = [];
  if (s.isSa || s.isAdmin || hasAnyPermission(s, [...RES.orgAdmin])) roles.push("manager");
  if (hasAnyPermission(s, [...RES.monitoring, ...RES.alert])) roles.push("care");
  return roles;
}
