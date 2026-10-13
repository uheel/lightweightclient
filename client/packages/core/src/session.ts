/**
 * 登录会话。token 只保存在内存里，关闭应用即失效；
 * 服务器地址和用户名记在 localStorage，方便下次登录。
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

let current: Session | null = null;
const listeners = new Set<Listener>();

function emit(reason?: "expired") {
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
