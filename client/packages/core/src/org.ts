import { api } from "./http";
import { session } from "./session";

export interface OrgNode {
  key: string;
  value: string;
  title: string;
  orgType: number;
  parentKey?: string;
  children?: OrgNode[];
}

export async function getOrgTree() {
  return (await api.get<OrgNode[]>("/sapi/org/tree")).data ?? [];
}

export function findOrg(nodes: OrgNode[], value: string): OrgNode | undefined {
  for (const n of nodes) {
    if (n.value === value) return n;
    const c = n.children && findOrg(n.children, value);
    if (c) return c;
  }
}

/**
 * 切换当前机构：之后所有请求的 orgid / orgtype 请求头随之改变。
 * 权限 key 是按 orgId:userId 计算的，所以要重新获取。
 */
export async function switchOrg(node: OrgNode) {
  const s = session.get();
  if (!s || node.value === s.orgId) return;
  const org = { orgId: node.value, orgType: Number(node.orgType) };
  let resources = s.resources;
  try {
    resources = (await api.get<string[]>("/sapi/permission/resources", { org })).data ?? [];
  } catch {
    /* 保留旧值 */
  }
  session.update({ ...org, orgName: node.title, resources });
}
