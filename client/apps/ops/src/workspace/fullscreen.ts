import { isTauri } from "@radar/core";

const currentWindow = () => import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());
/** 进全屏前窗口是不是最大化的，退出全屏时还原 */
let wasMaximized = false;

/**
 * 窗口全屏（监控模式、数据魔墙放映共用）。Windows 上无边框窗口有两个坑，都会让网页区域比屏幕矮、底下露出一条底色：
 * 1. 最大化状态下直接全屏，网页还停在最大化时的高度（屏幕减任务栏），所以先取消最大化；
 * 2. 窗口带阴影时也会少一截，全屏期间关掉阴影。
 * 浏览器调试时用网页全屏。
 */
export async function enterFullscreen() {
  if (!isTauri) return void (await document.documentElement.requestFullscreen?.().catch(() => {}));
  const w = await currentWindow();
  wasMaximized = await w.isMaximized();
  if (wasMaximized) await w.unmaximize();
  await w.setShadow(false);
  await w.setFullscreen(true);
}

export async function leaveFullscreen() {
  if (!isTauri) return void (document.fullscreenElement && (await document.exitFullscreen().catch(() => {})));
  const w = await currentWindow();
  if (!(await w.isFullscreen())) return;
  await w.setFullscreen(false);
  await w.setShadow(true);
  if (wasMaximized) await w.maximize();
  wasMaximized = false;
}

export async function isFullscreen() {
  if (!isTauri) return !!document.fullscreenElement;
  return (await currentWindow()).isFullscreen();
}
