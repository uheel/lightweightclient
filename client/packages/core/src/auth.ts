import { api, ApiError } from "./http";
import { loadPrefs, type Session } from "./session";

export const SERVERS = [
  { label: "正式环境 rd.igoodlife.com", value: "https://rd.igoodlife.com" },
  { label: "海外 global.igoodlife.com", value: "https://global.igoodlife.com" },
  { label: "预发布 preprod.igoodlife.com", value: "https://preprod.igoodlife.com" },
];

/**
 * 打包给客户的客户端只连正式环境，登录页不显示服务器选择（之前记住的服务器也不用）；
 * 开发版（tauri dev、浏览器调试）可以切换，方便测海外和预发布。
 */
export const CAN_PICK_SERVER = import.meta.env.DEV;

/** 登录用的服务器：开发版用上次记住的，打包版固定正式环境 */
export function initialServer() {
  return (CAN_PICK_SERVER && loadPrefs().server) || SERVERS[0].value;
}

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
