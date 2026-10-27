import { useSyncExternalStore } from "react";
import { ALERT_GROUPS } from "../api/device";

/** 告警弹窗设置（系统设置里改），存在本机，所有机构共用；默认关闭 */
export interface PopupSettings {
  enabled: boolean;
  /** 哪些告警分组要提醒（ALERT_GROUPS 的 value） */
  groups: number[];
}

const KEY = "ops.alertPopup";
const DEFAULT: PopupSettings = { enabled: false, groups: ALERT_GROUPS.map((g) => g.value) };

function load(): PopupSettings {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<PopupSettings>) };
  } catch {
    return DEFAULT;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function setPopupSettings(patch: Partial<PopupSettings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* 存不了也照样生效到关窗 */
  }
  listeners.forEach((f) => f());
}

export function usePopupSettings() {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
}
