import { invoke } from "@tauri-apps/api/core";
import { session } from "./session";
import { formatBytes, perfLog } from "./perf";

/** 平台统一的响应格式 */
export interface ApiResult<T> {
  succeeded: boolean;
  data: T;
  total?: number;
  message?: string;
  /** 这次请求各阶段的耗时（毫秒），见 ReqPerf */
  perf?: ReqPerf;
}

/**
 * 一次请求的耗时拆分。queue / ttfb / body 是 Rust 层测的（排队等连接名额 / 发出到收到响应头，含平台处理 / 下载响应体）；
 * ipc = invoke 往返总时间减去 Rust 层的部分（响应体按原始字节经 IPC 传到 WebView）；parse = WebView 里解码 UTF-8 + JSON.parse。
 * 浏览器调试时没有 Rust 层，只有 fetch（含代理）和 parse。pages 是 getAll 一次取回的页数。
 */
export interface ReqPerf {
  queue?: number;
  ttfb?: number;
  body?: number;
  ipc?: number;
  fetch?: number;
  parse: number;
  bytes: number;
  pages?: number;
  total: number;
}

interface RustTiming {
  queue: number;
  ttfb: number;
  body: number;
  bytes: number;
  pages: number;
}

interface Fetched {
  status: number;
  text: string;
  timing?: RustTiming;
  /** Tauri 里解码原始字节的耗时，算进 parse */
  decode: number;
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export const isTauri = "__TAURI_INTERNALS__" in window;

const utf8 = new TextDecoder();

/**
 * 调用 Rust 的请求命令（请求由 Rust 层发出，绕开 WebView 的 CORS，共用连接池，开了 gzip，见 rust/api_http.rs）。
 * 返回的是原始字节：第一行是状态码和耗时的 JSON，换行后是响应体。
 */
async function tauriInvoke(cmd: string, args: Record<string, unknown>): Promise<Fetched> {
  const buf = await invoke<ArrayBuffer>(cmd, args);
  const t = performance.now();
  const bytes = new Uint8Array(buf);
  const nl = bytes.indexOf(10);
  const meta = JSON.parse(utf8.decode(bytes.subarray(0, nl))) as { status: number; timing: RustTiming };
  const text = utf8.decode(bytes.subarray(nl + 1));
  return { status: meta.status, text, timing: meta.timing, decode: performance.now() - t };
}

/** 普通浏览器调试时走 vite 的 /__proxy 代理，目标服务器见 vite.js */
async function doFetch(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Fetched> {
  if (isTauri) return tauriInvoke("api_request", { method: init.method, url, headers: init.headers, body: init.body ?? null });
  const res = await window.fetch(url, init);
  return { status: res.status, text: await res.text(), decode: 0 };
}

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

/** 分页参数：Tauri 里交给 Rust 的 api_request_pages 并发取完，见 getAll */
interface PagesOptions {
  pageSize: number;
  max: number;
}

export async function request<T>(method: string, path: string, o: RequestOptions = {}, pages?: PagesOptions): Promise<ApiResult<T>> {
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

  const t0 = performance.now();
  let res: Fetched;
  try {
    const url = apiBase(server) + path + buildQuery(o);
    res = pages
      ? await tauriInvoke("api_request_pages", { url, headers, pageSize: pages.pageSize, maxRows: pages.max })
      : await doFetch(url, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  } catch (e) {
    perfLog({ label: `${method} ${path}`, total: performance.now() - t0, stages: {}, info: { error: e instanceof Error ? e.message : String(e) } });
    throw new ApiError(`网络请求失败：${e instanceof Error ? e.message : String(e)}`);
  }

  if (res.status === 401) {
    // 只有用当前会话的 token 请求时才认为是会话过期
    if (!o.token && s) session.expire();
    throw new ApiError("登录已失效，请重新登录", 401);
  }
  if (res.status < 200 || res.status >= 300) throw new ApiError(`HTTP ${res.status}`, res.status);

  const t1 = performance.now();
  const json = JSON.parse(res.text) as ApiResult<T>;
  const t2 = performance.now();
  const tm = res.timing;
  const parse = t2 - t1 + res.decode;
  const perf: ReqPerf = tm
    ? { queue: tm.queue, ttfb: tm.ttfb, body: tm.body, ipc: t1 - res.decode - t0 - tm.queue - tm.ttfb - tm.body, parse, bytes: tm.bytes, pages: tm.pages, total: t2 - t0 }
    : { fetch: t1 - t0, parse, bytes: res.text.length, total: t2 - t0 };
  json.perf = perf;
  const { bytes, total, pages: pageCount, ...stages } = perf;
  perfLog({
    label: `${method} ${path}`,
    total,
    stages: Object.fromEntries(Object.entries(stages).filter((e): e is [string, number] => e[1] !== undefined)),
    info: { size: formatBytes(bytes), rows: Array.isArray(json.data) ? json.data.length : -1, ...(pageCount && pageCount > 1 ? { pages: pageCount } : {}) },
  });
  if (!json.succeeded) throw new ApiError(json.message || "请求失败", res.status);
  return json;
}

/**
 * 取一个分页 GET 接口的全部数据（最多 max 条），返回合并后的 data 和平台的 total。
 * Tauri 里由 Rust 先取第 1 页拿到 total，其余页并发取再拼好返回（一次 IPC）；浏览器调试时在这里同样先取第 1 页再并发取其余页。
 * 分页之间有新数据写入时页边界可能重复或遗漏，时间范围固定的查询没有这个问题。
 */
export async function getAll<T>(path: string, o: RequestOptions & { pageSize: number; max: number }): Promise<ApiResult<T[]>> {
  const { pageSize, max, ...rest } = o;
  if (isTauri) return request<T[]>("GET", path, rest, { pageSize, max });
  const t0 = performance.now();
  const page = (current: number) => request<T[]>("GET", path, { ...rest, params: { ...rest.params, current, pageSize } });
  const first = await page(1);
  const n = Math.max(1, Math.ceil(Math.min(first.total ?? 0, max) / pageSize));
  const others = await Promise.all(Array.from({ length: n - 1 }, (_, i) => page(i + 2)));
  const all = [first, ...others];
  const perf: ReqPerf = { fetch: 0, parse: 0, bytes: 0, pages: n, total: performance.now() - t0 };
  for (const r of all) {
    perf.parse += r.perf?.parse ?? 0;
    perf.bytes += r.perf?.bytes ?? 0;
  }
  perf.fetch = perf.total - perf.parse;
  return { ...first, data: all.flatMap((r) => r.data ?? []), perf };
}

export const api = {
  get: <T>(path: string, o?: RequestOptions) => request<T>("GET", path, o),
  getAll,
  post: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>("POST", path, { ...o, body }),
  put: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>("PUT", path, { ...o, body }),
  del: <T>(path: string, o?: RequestOptions) => request<T>("DELETE", path, o),
};
