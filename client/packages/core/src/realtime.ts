import * as signalR from "@microsoft/signalr";
import { apiBase } from "./http";
import { session } from "./session";

/**
 * 平台的实时通道：ASP.NET Core SignalR，地址 /hub/message。
 * 网页端的做法（vendors.sdb）：WebSocket 直连、跳过 negotiate，token 走 access_token，
 * 连上后 send("AddToGroupAsync", orgId) 加入当前机构的组。
 *
 * 设备数据要按频道订阅：每台设备两个频道 `{sn}` 和 `{sn}:radar`，
 * 多个频道用逗号拼成一个参数调用 AddToGroupAsync / RemoveFromGroupAsync。
 *
 * 服务端推送的已知方法：
 * - DeviceData：设备实时数据 {sn, msgType, payload, timestamp, dataType}，msgType 含义见 deviceData.ts
 * - Alert / AlertClose / AlertCount：告警产生、关闭、未处理数变化
 * - Record / Person：实时报警记录、人员报警
 * - AntNotice / AntNoticeClose / AntNotification / AntNotificationClose：平台下发的提示
 * - DeviceResponse：设备对属性读写指令的应答 {sn, command:"get-property"|"set-property", seq, code, message, data}
 * - DeviceConfigChange：设备场景读写完成 {sn, command:"read"|"write", data}，读场景时 data.scenes 是场景列表
 */

export type RealtimeState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface RealtimeEvent {
  time: number;
  method: string;
  payload: unknown;
}

const KNOWN_METHODS = [
  "DeviceData",
  "Alert",
  "AlertClose",
  "AlertCount",
  "Record",
  "Person",
  "AntNotice",
  "AntNoticeClose",
  "AntNotification",
  "AntNotificationClose",
  "DeviceResponse",
  "DeviceConfigChange",
];

/** 已订阅的频道（引用计数）。连接 / 重连成功后会整体重新订阅 */
const channels = new Map<string, number>();

export function deviceChannels(sn: string) {
  return [sn, `${sn}:radar`];
}

type StateListener = (s: RealtimeState, error?: string) => void;
type EventListener = (e: RealtimeEvent) => void;

let conn: signalR.HubConnection | null = null;
/** 每次 start / stop 加一，用来丢弃过期的异步启动 */
let generation = 0;
let state: RealtimeState = "disconnected";
let lastError: string | undefined;
const stateListeners = new Set<StateListener>();
const eventListeners = new Set<EventListener>();

function setState(s: RealtimeState, error?: string) {
  state = s;
  lastError = error;
  for (const l of stateListeners) l(s, error);
}

function emitEvent(method: string, payload: unknown) {
  // 平台推送的内容有时是 JSON 字符串
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      /* 保留原文 */
    }
  }
  const e = { time: Date.now(), method, payload };
  for (const l of eventListeners) l(e);
}

/** 截获 "No client method with the name 'xxx' found" 警告，用来发现还没注册的推送方法 */
class ProbeLogger implements signalR.ILogger {
  log(level: signalR.LogLevel, message: string) {
    const m = /No client method with the name '([^']+)' found/i.exec(message);
    if (m) emitEvent(m[1], "(未注册的推送方法，内容未解析)");
    if (level >= signalR.LogLevel.Error) console.error("[SignalR]", message);
  }
}

async function closeCurrent() {
  const c = conn;
  conn = null;
  if (c) {
    try {
      await c.stop();
    } catch {
      /* 忽略 */
    }
  }
}

export async function startRealtime() {
  const gen = ++generation;
  await closeCurrent();
  const s = session.get();
  if (gen !== generation) return;
  if (!s) return setState("disconnected");

  const c = new signalR.HubConnectionBuilder()
    .withUrl(apiBase(s.server) + "/hub/message", {
      accessTokenFactory: () => session.get()?.token ?? "",
      skipNegotiation: true,
      transport: signalR.HttpTransportType.WebSockets,
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
    .configureLogging(new ProbeLogger())
    .build();

  for (const m of KNOWN_METHODS) c.on(m, (payload) => emitEvent(m, payload));

  const joinGroup = async () => {
    const orgId = session.get()?.orgId;
    if (orgId) await c.send("AddToGroupAsync", orgId);
    if (channels.size) await c.send("AddToGroupAsync", [...channels.keys()].join(","));
  };

  c.onreconnecting((err) => setState("reconnecting", err?.message));
  c.onreconnected(async () => {
    await joinGroup();
    setState("connected");
  });
  c.onclose((err) => {
    if (conn === c) setState("disconnected", err?.message);
  });

  conn = c;
  setState("connecting");
  try {
    await c.start();
    if (gen !== generation) return;
    await joinGroup();
    setState("connected");
  } catch (e) {
    if (conn === c) setState("disconnected", e instanceof Error ? e.message : String(e));
  }
}

export async function stopRealtime() {
  const gen = ++generation;
  await closeCurrent();
  // 停止期间如果又发起了新连接，就不要覆盖它的状态
  if (gen === generation) setState("disconnected");
}

/** 订阅频道；已连接时立即生效，未连接时在连接成功后自动订阅 */
export function subscribeChannels(list: string[]) {
  const added = list.filter((ch) => {
    const n = channels.get(ch) ?? 0;
    channels.set(ch, n + 1);
    return n === 0;
  });
  if (added.length && conn?.state === signalR.HubConnectionState.Connected) {
    conn.send("AddToGroupAsync", added.join(",")).catch((e) => console.error("[SignalR] 订阅失败", e));
  }
  return () => unsubscribeChannels(list);
}

export function unsubscribeChannels(list: string[]) {
  const removed = list.filter((ch) => {
    const n = channels.get(ch) ?? 0;
    if (n <= 1) {
      channels.delete(ch);
      return n === 1;
    }
    channels.set(ch, n - 1);
    return false;
  });
  if (removed.length && conn?.state === signalR.HubConnectionState.Connected) {
    conn.send("RemoveFromGroupAsync", removed.join(",")).catch(() => {});
  }
}

export const realtime = {
  get state() {
    return state;
  },
  get lastError() {
    return lastError;
  },
  onState(l: StateListener) {
    stateListeners.add(l);
    return () => void stateListeners.delete(l);
  },
  onEvent(l: EventListener) {
    eventListeners.add(l);
    return () => void eventListeners.delete(l);
  },
  /** 只监听某一个推送方法 */
  on(method: string, cb: (payload: unknown, e: RealtimeEvent) => void) {
    return realtime.onEvent((e) => {
      if (e.method === method) cb(e.payload, e);
    });
  },
};
