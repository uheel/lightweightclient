import { isTauri } from "@radar/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { TrayIcon } from "@tauri-apps/api/tray";

/**
 * 桌面能力（只在 Tauri 里生效，浏览器调试时全部跳过）：
 * 系统通知、任务栏闪烁、托盘提示文字、唤起主窗口。
 */

let permission: boolean | undefined;

export async function ensureNotifyPermission() {
  if (!isTauri) return false;
  if (permission !== undefined) return permission;
  try {
    permission = (await isPermissionGranted()) || (await requestPermission()) === "granted";
  } catch {
    permission = false;
  }
  return permission;
}

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

export async function notify(title: string, body: string) {
  if (!(await ensureNotifyPermission())) return;
  sendNotification({ title, body });
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
