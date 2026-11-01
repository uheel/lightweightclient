import { createContext, useContext, useEffect, useRef } from "react";
import { onApiWrite } from "@radar/core";

/**
 * 跨页面的数据变更：打开的标签都一直挂着，每页只在挂载时取一次数据，别的页面改了数据它不知道。
 * 这里在请求层看所有写操作，按地址换算成"哪类数据变了"，新增写接口时页面不用各自记得发通知。
 * 被隐藏的页面只记下"数据旧了"，切回来时才静默重取一次（平台请求要省着用）；
 * 正在看的页面是写操作的发起方，它已经更新了本地数据，不重取。
 * 例外是刚切过来的页面：这时候完成的写操作多半是上一页没写完的（保存还在转圈就切了标签），也要重取。
 */
export type Topic =
  /** 设备的增删改、绑定房间 / 床位 / 长者、管理主机 */
  | "device"
  /** 楼栋、楼层、房间、床位 */
  | "space"
  /** 房间布置 */
  | "design"
  /** 长者、入住 */
  | "member"
  /** 写到设备上的配置：属性、场景、通话 */
  | "config"
  | "alert";

/** 按顺序匹配地址前缀，第一条命中的算数 */
const RULES: [prefix: string, topics: Topic[]][] = [
  ["/api/device-property/write", ["config"]],
  ["/api/device-scene/scene", ["config"]],
  ["/api/device-config/call", ["config"]],
  ["/api/device", ["device"]],
  ["/api/monitor-watch", ["device"]],
  ["/api/master", ["device"]],
  ["/api/room/v3/design", ["design"]],
  ["/api/room/v3", ["space", "design"]],
  ["/api/room", ["space"]],
  ["/api/building", ["space"]],
  ["/api/floor", ["space"]],
  ["/api/bed", ["space"]],
  ["/api/member", ["member"]],
  ["/api/alert/", ["alert"]],
];

/**
 * 不影响别的页面的 POST / PUT：实际是读取的、只有自己那一页用的。
 * 告警推送设置（系统设置 ↔ 告警配置）有自己的通知，见 api/orgSettings.ts
 */
const IGNORE = [
  "/sapi/account/",
  "/sapi/setting",
  "/sapi/oss",
  "/api/device-property/read",
  "/api/device-scene/read",
  "/api/device-config/verify-expression",
  "/api/caregiver",
  "/api/alert-process-type",
  "/api/alert-type",
  "/api/settings/org",
];

const ALL: Topic[] = ["device", "space", "design", "member", "config", "alert"];

/** 切到页面后多久之内完成的写操作，算上一页发起的（一次保存连着写几个接口，通常两三秒） */
const JUST_SWITCHED_MS = 5000;

/** 没登记的写接口按"什么都可能变了"算：顶多多取一次，不会漏 */
function topicsOf(path: string): Topic[] {
  if (IGNORE.some((p) => path.startsWith(p))) return [];
  return RULES.find(([p]) => path.startsWith(p))?.[1] ?? ALL;
}

type Listener = (topics: Topic[]) => void;
const listeners = new Set<Listener>();

onApiWrite((path) => {
  const topics = topicsOf(path);
  if (topics.length) listeners.forEach((f) => f(topics));
});

/** 底层订阅：模块里的缓存、不在标签页里的东西用；页面用 useRefreshOn */
export function onDataChanged(f: Listener) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** 所在的标签页是不是正显示着（监控模式盖在上面时不算）。不在标签页里的组件总是 true */
export const PaneActive = createContext(true);

/**
 * 这几类数据被别的页面改了之后重取：页面隐藏时改的，切回来时调一次 refresh。
 * 有些数据的修改不是页面自己发起的（告警提醒弹窗里处理告警），用 whileVisible，显示着也马上重取。
 * refresh 要静默：不清空当前内容、不丢选中和没保存的编辑。
 */
export function useRefreshOn(topics: readonly Topic[], refresh: () => unknown, opts?: { whileVisible?: boolean }) {
  const active = useContext(PaneActive);
  const latest = useRef({ refresh, topics, active, whileVisible: opts?.whileVisible });
  latest.current = { refresh, topics, active, whileVisible: opts?.whileVisible };
  const stale = useRef(false);
  const activeSince = useRef(Date.now());

  useEffect(() => {
    let timer: number | undefined;
    const off = onDataChanged((changed) => {
      const cur = latest.current;
      if (!changed.some((t) => cur.topics.includes(t))) return;
      if (!cur.active) stale.current = true;
      else if (cur.whileVisible || Date.now() - activeSince.current < JUST_SWITCHED_MS) {
        // 一次操作可能连着写好几个接口，等写完再取
        window.clearTimeout(timer);
        timer = window.setTimeout(() => latest.current.refresh(), 300);
      }
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (active) activeSince.current = Date.now();
    if (active && stale.current) {
      stale.current = false;
      latest.current.refresh();
    }
  }, [active]);
}
