import { isTauri } from "@radar/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { TrayIcon } from "@tauri-apps/api/tray";

/**
 * 桌面能力（只在 Tauri 里生效，浏览器调试时全部跳过）：
 * 告警弹窗、提示音、任务栏闪烁、托盘提示文字、唤起主窗口。
 */

/** 主窗口是否正在前台（可见且有焦点） */
export async function isWindowActive() {
  if (!isTauri) return document.hasFocus();
  try {
    const w = getCurrentWindow();
    return (await w.isVisible()) && (await w.isFocused()) && !(await w.isMinimized());
  } catch {
    return document.hasFocus();
  }
}

/**
 * 告警弹窗（不用系统通知：开发版会挂在 PowerShell 名下，"请勿打扰"时不弹，几秒就收起）。
 * 弹窗是单独的置顶小窗口（src-tauri/src/lib.rs 里建好、隐藏），只负责显示；
 * 告警数据和"什么时候显示"都由主窗口决定，通过事件推过去。
 */
export interface PopupAlert {
  id: string;
  type: string;
  /** 长者姓名 */
  who?: string;
  /** 楼栋 · 楼层 · 房间 */
  where: string;
  createdAt: string;
}

export interface PopupState {
  alerts: PopupAlert[];
  visible: boolean;
}

export const POPUP_LABEL = "alert-popup";

/** 主窗口 → 弹窗 */
export function pushPopup(state: PopupState) {
  if (!isTauri) return;
  emitTo(POPUP_LABEL, "popup:state", state).catch(() => {});
}

/** 主窗口监听弹窗上的操作：ready（弹窗页面刚加载好，要一份当前状态）、open（去处理）、snooze（稍后提醒） */
export function onPopupAction(h: { ready: () => void; open: (id: string) => void; snooze: () => void }) {
  if (!isTauri) return () => {};
  const offs = [listen("popup:ready", h.ready), listen<string>("popup:open", (e) => h.open(e.payload)), listen("popup:snooze", h.snooze)];
  return () => offs.forEach((p) => p.then((off) => off()));
}

/** 弹窗 → 主窗口 */
export function popupAction(name: "ready" | "open" | "snooze", payload?: string) {
  emitTo("main", `popup:${name}`, payload).catch(() => {});
}

export function showPopup(height: number) {
  return invoke("alert_popup_show", { height }).catch(() => {});
}

export function hidePopup() {
  return invoke("alert_popup_hide").catch(() => {});
}

/**
 * 提示音：两声短促的上行音（WebAudio 合成，不用音频文件）。
 * 在主窗口里播放：主窗口登录时有过点击，浏览器允许它出声；弹窗页面从没被点过，播放会被拦下。
 */
let audio: AudioContext | undefined;
export function chime() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const t0 = audio.currentTime + 0.02;
    for (const [i, freq] of [880, 1175].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const t = t0 + i * 0.18;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    }
  } catch {
    /* 没有声卡等情况，忽略 */
  }
}

/** 任务栏图标闪烁，直到用户切回窗口 */
export async function requestAttention() {
  if (!isTauri) return;
  try {
    await getCurrentWindow().requestUserAttention(UserAttentionType.Critical);
  } catch {
    /* 忽略 */
  }
}

export async function showMainWindow() {
  if (!isTauri) return;
  const w = getCurrentWindow();
  await w.unminimize().catch(() => {});
  await w.show().catch(() => {});
  await w.setFocus().catch(() => {});
}

export async function setTrayTooltip(text: string) {
  if (!isTauri) return;
  try {
    const tray = await TrayIcon.getById("main");
    await tray?.setTooltip(text);
  } catch {
    /* 忽略 */
  }
}
