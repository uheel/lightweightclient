import { api, ApiError } from "./http";
import type { Session } from "./session";

export const SERVERS = [
  { label: "正式环境 rd.igoodlife.com", value: "https://rd.igoodlife.com" },
  { label: "海外 global.igoodlife.com", value: "https://global.igoodlife.com" },
  { label: "预发布 preprod.igoodlife.com", value: "https://preprod.igoodlife.com" },
];

interface SignInData {
  token: string;
  userId: string;
  userName: string;
  realName?: string;
  nickName?: string;
  isSa?: boolean;
  isAdmin?: boolean;
  orgId: string;
  orgType: number;
  orgName: string;
}

/** 与网页端相同的登录流程：signIn → permission/resources */
export async function signIn(server: string, username: string, password: string): Promise<Session> {
  const res = await api.post<SignInData>("/sapi/account/signIn", { username, password }, { server });
  const d = res.data;
  if (!d?.token) throw new ApiError("登录失败，返回数据为空");

  const perm = await api.get<string[]>("/sapi/permission/resources", { server, token: d.token });
  const resources = perm.data ?? [];
  if (!d.isSa && resources.length === 0) throw new ApiError("登录失败，当前账号未初始化权限");

  return {
    server,
    token: d.token,
    userId: d.userId,
    userName: d.userName ?? username,
    realName: d.realName,
    nickName: d.nickName,
    isSa: !!d.isSa,
    isAdmin: !!d.isAdmin,
    orgId: d.orgId,
    orgType: Number(d.orgType),
    orgName: d.orgName,
    rawOrgId: d.orgId,
    resources,
  };
}

export async function signOut() {
  try {
    await api.post("/sapi/account/signOut");
  } catch {
    /* token 可能已过期，忽略 */
  }
}
