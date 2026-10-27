import { isTauri } from "@radar/core";
import { TrayIcon } from "@tauri-apps/api/tray";

/**
 * 桌面能力（只在 Tauri 里生效，浏览器调试时全部跳过）。
 * 告警弹窗、提示音、任务栏闪烁、唤起主窗口和运维端共用，在 packages/core/src/alertPopup.ts；
 * 这里只有用户端才有的托盘。
 */
export { chime, isWindowActive, onPopupAction, pushPopup, requestAttention, showMainWindow, type PopupAlert } from "@radar/core";

export async function setTrayTooltip(text: string) {
  if (!isTauri) return;
  try {
    const tray = await TrayIcon.getById("main");
    await tray?.setTooltip(text);
  } catch {
    /* 忽略 */
  }
}
