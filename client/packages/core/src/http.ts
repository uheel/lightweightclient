import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { session } from "./session";

/** 平台统一的响应格式 */
export interface ApiResult<T> {
  succeeded: boolean;
  data: T;
  total?: number;
  message?: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export const isTauri = "__TAURI_INTERNALS__" in window;

/**
 * Tauri 里用 plugin-http（请求由 Rust 层发出，绕开 WebView 的 CORS）；
 * 普通浏览器调试时走 vite 的 /__proxy 代理，目标服务器见 vite.config.ts。
 */
const doFetch: typeof fetch = isTauri ? tauriFetch : window.fetch.bind(window);

export function apiBase(server: string) {
  return isTauri ? server.replace(/\/+$/, "") : "/__proxy";
}

type ParamValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  /** 普通查询参数，如 current / pageSize */
  params?: Record<string, ParamValue>;
  /** 会被写成 filter[key]=value */
  filter?: Record<string, ParamValue>;
  body?: unknown;
  /** 覆盖当前会话的 token / 服务器（登录时用） */
  token?: string;
  server?: string;
  /** 覆盖当前机构（跨机构查询时用） */
  org?: { orgId: string; orgType: number };
}

function buildQuery(o: RequestOptions) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o.params ?? {})) {
    if (v !== undefined && v !== null && v !== "") q.append(k, String(v));
  }
  for (const [k, v] of Object.entries(o.filter ?? {})) {
    if (v !== undefined && v !== null && v !== "") q.append(`filter[${k}]`, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function request<T>(method: string, path: string, o: RequestOptions = {}): Promise<ApiResult<T>> {
  const s = session.get();
  const server = o.server ?? s?.server;
  if (!server) throw new ApiError("未选择服务器");
  const token = o.token ?? s?.token;
  const org = o.org ?? (s ? { orgId: s.orgId, orgType: s.orgType } : undefined);

  const headers: Record<string, string> = { locale: "zh-CN", accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) {
    headers.orgid = org.orgId;
    headers.orgtype = String(org.orgType);
  }
  if (o.body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await doFetch(apiBase(server) + path + buildQuery(o), {
      method,
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    throw new ApiError(`网络请求失败：${e instanceof Error ? e.message : String(e)}`);
  }

  if (res.status === 401) {
    // 只有用当前会话的 token 请求时才认为是会话过期
    if (!o.token && s) session.expire();
    throw new ApiError("登录已失效，请重新登录", 401);
  }
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);

  const json = (await res.json()) as ApiResult<T>;
  if (!json.succeeded) throw new ApiError(json.message || "请求失败", res.status);
  return json;
}

export const api = {
  get: <T>(path: string, o?: RequestOptions) => request<T>("GET", path, o),
  post: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>("POST", path, { ...o, body }),
  put: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>("PUT", path, { ...o, body }),
  del: <T>(path: string, o?: RequestOptions) => request<T>("DELETE", path, o),
};
