/**
 * 登录会话。token 只保存在内存里，关闭应用即失效；
 * 服务器地址和用户名记在 localStorage，方便下次登录。
 *
 * 例外：在浏览器里调试（vite 开发服务器、localhost，不在 Tauri 里）时，会话另存一份在 sessionStorage，
 * 改代码触发页面整体刷新时不用重新登录。只在当前标签页有效，关掉标签页就没了。客户端（Tauri）里不存。
 */
export interface Session {
  server: string;
  token: string;
  userId: string;
  userName: string;
  realName?: string;
  nickName?: string;
  isSa: boolean;
  isAdmin: boolean;
  /** 当前机构（请求头 orgid / orgtype） */
  orgId: string;
  orgType: number;
  orgName: string;
  /** 登录时所在的机构 */
  rawOrgId: string;
  /** /sapi/permission/resources 返回的权限 key（已按 orgId:userId:key 做过 md5） */
  resources: string[];
}

type Listener = (s: Session | null, reason?: "expired") => void;

const DEV_KEY = "RC_DEV_SESSION";
const devPersist = !("__TAURI_INTERNALS__" in window) && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

function loadDev(): Session | null {
  if (!devPersist) return null;
  try {
    const s = sessionStorage.getItem(DEV_KEY);
    return s ? (JSON.parse(s) as Session) : null;
  } catch {
    return null;
  }
}

function saveDev(s: Session | null) {
  if (!devPersist) return;
  try {
    if (s) sessionStorage.setItem(DEV_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(DEV_KEY);
  } catch {
    /* 存不了就和客户端一样，刷新后重新登录 */
  }
}

let current: Session | null = loadDev();
const listeners = new Set<Listener>();

function emit(reason?: "expired") {
  saveDev(current);
  for (const l of listeners) l(current, reason);
}

export const session = {
  get: () => current,
  set(s: Session | null) {
    current = s;
    emit();
  },
  update(patch: Partial<Session>) {
    if (!current) return;
    current = { ...current, ...patch };
    emit();
  },
  expire() {
    current = null;
    emit("expired");
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

const PREFS_KEY = "RC_LOGIN_PREFS";

export interface LoginPrefs {
  server: string;
  username: string;
}

export function loadPrefs(): Partial<LoginPrefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function savePrefs(p: LoginPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 忽略 */
  }
}
