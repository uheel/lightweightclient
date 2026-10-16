import { isTauri } from "./http";

/**
 * 客户端里去掉 WebView 的网页行为，让它像桌面应用。浏览器调试模式不拦，方便用"检查"。
 * - 右键菜单（返回、刷新、另存为、检查……）：只在输入框里和选中了文字时保留
 * - Ctrl+滚轮 / Ctrl+加减号 缩放页面
 * - 拖动图片、链接
 * - 正式版里 F5 / Ctrl+R 刷新（登录状态只在内存里，一刷新就退出登录）、Ctrl+P 打印、Ctrl+F 网页查找
 * - 文字默认不可选，样式见 AppShell.css 的 .is-desktop
 * - Win11 上标题栏和模块栏透出 Mica Alt 材质（窗口在 tauri.conf.json 里开了 tabbed + transparent），样式见 .has-mica
 */
if (isTauri) {
  document.documentElement.classList.add("is-desktop");

  // 只有 Win11（platformVersion 主版本 ≥ 13）支持 Mica；Win10 上不加 .has-mica，背景保持不透明，不会看穿窗口
  const uaData = (navigator as Navigator & {
    userAgentData?: { platform: string; getHighEntropyValues(h: string[]): Promise<{ platformVersion?: string }> };
  }).userAgentData;
  if (uaData?.platform === "Windows") {
    uaData
      .getHighEntropyValues(["platformVersion"])
      .then(({ platformVersion }) => {
        if (Number(platformVersion?.split(".")[0]) >= 13) document.documentElement.classList.add("has-mica");
      })
      .catch(() => {});
  }

  document.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
  });

  // 只阻止浏览器缩放；组件自己监听的 Ctrl+滚轮（比如姿态视图缩放）不受影响
  document.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), { passive: false });

  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && ["=", "+", "-", "0"].includes(k)) e.preventDefault();
    if (import.meta.env.DEV) return;
    if (k === "f5" || (ctrl && ["r", "p", "f", "g", "u"].includes(k))) e.preventDefault();
  });

  document.addEventListener("dragstart", (e) => {
    // 明确写了 draggable="true" 的元素是功能需要，放行
    if (e.target instanceof HTMLElement && e.target.getAttribute("draggable") === "true") return;
    e.preventDefault();
  });
}
