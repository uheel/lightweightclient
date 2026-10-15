import { invoke } from "@tauri-apps/api/core";
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
 * Tauri 里调用 Rust 命令 api_request（请求由 Rust 层发出，绕开 WebView 的 CORS，并且共用连接池，见 rust/api_http.rs）；
 * 普通浏览器调试时走 vite 的 /__proxy 代理，目标服务器见 vite.js。
 */
async function tauriFetch(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Response> {
  const r = await invoke<{ status: number; body: string }>("api_request", { method: init.method, url, headers: init.headers, body: init.body ?? null });
  const empty = r.status === 204 || r.status === 205 || r.status === 304;
  return new Response(empty ? null : r.body, { status: r.status });
}

const doFetch = isTauri ? tauriFetch : (url: string, init: RequestInit) => window.fetch(url, init);

/**
 * 让 Rust 层提前建好并保持到服务器的连接（平台只支持 HTTP/1.1，新建连接在丢包网络下握手常卡 3–19 秒，见 rust/api_http.rs）。
 * 地址没变时 Rust 那边什么都不做，可以随便多次调用。浏览器调试时不需要。
 */
export function warmUp(server: string) {
  if (isTauri) invoke("api_warm", { server }).catch(() => {});
}

export function apiBase(server: string) {
  return isTauri ? server.replace(/\/+$/, "") : "/__proxy";
}

/**
 * 平台返回的图片等资源地址（房间平面图的底图、家具图标等）常是相对路径，网页端在平台域名下能直接用，
 * 客户端里要补上服务器地址（浏览器调试时走 vite 代理）。完整地址、data: / blob: 原样返回。
 */
export function assetUrl(src: string) {
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  if (src.startsWith("//")) return "https:" + src;
  const server = session.get()?.server;
  if (!server) return src;
  return apiBase(server) + (src.startsWith("/") ? src : "/" + src);
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
  warmUp(server);
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
