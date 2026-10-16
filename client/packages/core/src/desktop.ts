import { isTauri } from "./http";

/**
 * 客户端里去掉 WebView 自带的右键菜单（返回、刷新、另存为、检查……），不像桌面应用。
 * 只保留两种情况：输入框里（要复制粘贴）和已经选中了文字（要复制 SN 之类）。
 * 浏览器调试模式不拦，方便用"检查"。
 */
if (isTauri) {
  document.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
  });
}
