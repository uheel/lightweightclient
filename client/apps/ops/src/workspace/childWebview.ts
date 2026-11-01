import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@radar/core";

/**
 * 盖在页面上的弹层：子 webview 是原生视图，永远在网页内容上面，这些弹层出来时会被它挡住，所以先把它藏起来。
 * 快速开始清单不算（它一直浮着，算上就一直看不到链接页了）
 */
const OVERLAYS = [
  ".ant-dropdown:not(.ant-dropdown-hidden)",
  ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  ".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)",
  ".ant-popover:not(.ant-popover-hidden)",
  ".ant-modal-wrap",
  ".ant-drawer-open",
  ".ant-notification-notice",
  ".ant-message-notice",
  ".monitor",
].join(",");

const overlayOpen = () =>
  [...document.querySelectorAll<HTMLElement>(OVERLAYS)].some((el) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0;
  });

/** 页面上有没有弹层（菜单、弹窗、提示、监控模式）；DOM 一变就重新看，一帧最多看一次 */
export function useOverlayOpen(enabled: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      setOpen(overlayOpen());
    };
    const mo = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(check);
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    check();
    return () => {
      mo.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return open;
}

/** 屏幕外的位置（后台加载时放这里） */
const OFFSCREEN = -20000;
/** 页面 load 事件后再等这么久才算好（平台的页面代码和接口要接着加载） */
const SETTLE_MS = 2000;
/** load 事件后这么久才把后台页面藏起来，让它把地图等画完 */
const PAINT_MS = 8000;

/**
 * 桌面端：在主窗口里另开一个子 webview 显示网址，跟着占位框的位置和大小走。子 webview 是独立的浏览器视图、不是嵌在页面里，
 * 网站设了 X-Frame-Options / frame-ancestors 也照样能显示。标签不在前台或有弹层时藏起来，关标签时关掉
 */
export function useChildWebview(
  box: RefObject<HTMLDivElement | null>,
  label: string,
  url: string | undefined,
  reload: number,
  visible: boolean,
  script?: string,
  /** 页面的设计尺寸：按它等比缩放（webview 缩放），在占位框里居中，页面始终以为自己在这么大的屏幕上 */
  design?: { width: number; height: number },
) {
  /** 带脚本的（平台页面）才用：页面加载好了。之前一直放在屏幕外，轮到也不显示，避免白屏 */
  const [ready, setReady] = useState(false);
  const sync = useRef<() => void>(undefined);
  /** 后台页面画完了，之后切走才能藏起来 */
  const painted = useRef(false);
  const view = useRef<import("@tauri-apps/api/webview").Webview>(undefined);
  const [error, setError] = useState<string>();
  const shown = useRef(visible);
  shown.current = visible && (!script || ready);

  // 网址变了或点了重新加载：关掉旧的、建新的
  useEffect(() => {
    if (!isTauri || !url || !box.current) return;
    let dead = false;
    let ro: ResizeObserver | undefined;
    let unlisten: (() => void) | undefined;
    let hideTimer: number | undefined;
    const ac = new AbortController();
    setError(undefined);
    setReady(false);
    painted.current = false;
    (async () => {
      const [{ Webview }, { getCurrentWindow }, { LogicalPosition, LogicalSize }] = await Promise.all([
        import("@tauri-apps/api/webview"),
        import("@tauri-apps/api/window"),
        import("@tauri-apps/api/dpi"),
      ]);
      if (dead || !box.current) return;
      /** 子 webview 该占的区域和缩放比例 */
      const rect = () => {
        const b = box.current!.getBoundingClientRect();
        if (!design) return { left: b.left, top: b.top, width: b.width, height: b.height, zoom: 1 };
        const zoom = Math.min(b.width / design.width, b.height / design.height);
        const width = design.width * zoom;
        const height = design.height * zoom;
        return { left: b.left + (b.width - width) / 2, top: b.top + (b.height - height) / 2, width, height, zoom };
      };
      const r = rect();
      const name = `${label}-${Date.now().toString(36)}`;
      const bounds = { x: script ? OFFSCREEN : Math.round(r.left), y: Math.round(r.top), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
      let w: import("@tauri-apps/api/webview").Webview;
      if (script) {
        // 要带初始化脚本：前端的 new Webview 不支持，由 Rust 建（child_webview.rs）
        // 先放屏幕外加载。加载完不马上藏：藏起来的页面不画图，地图还要点时间才画得完
        unlisten = await listen<string>("child-webview-loaded", (e) => {
          if (e.payload !== name || dead) return;
          unlisten?.();
          window.setTimeout(() => !dead && setReady(true), SETTLE_MS);
          hideTimer = window.setTimeout(() => {
            painted.current = true;
            if (!shown.current) view.current?.hide().catch(() => {});
          }, PAINT_MS);
        });
        await invoke("child_webview_create", { label: name, url, script, ...bounds });
        const made = await Webview.getByLabel(name);
        if (!made) throw new Error("子窗口没建成");
        w = made;
      } else {
        w = new Webview(getCurrentWindow(), name, { url, ...bounds });
        w.once("tauri://error", (e) => !dead && setError(String(e.payload)));
        await new Promise<void>((resolve) => void w.once("tauri://created", () => resolve()));
      }
      if (dead) return void w.close();
      view.current = w;
      let zoom = 1;
      if (!shown.current && !script) await w.hide();
      // 占位框挪动或变大小（拖窗口、开关快速开始横幅等）时跟着走
      const place = () => {
        const b = rect();
        if (!b.width || !b.height) return;
        // 带脚本的没轮到时留在屏幕外
        w.setPosition(new LogicalPosition(script && !shown.current ? OFFSCREEN : Math.round(b.left), Math.round(b.top)));
        w.setSize(new LogicalSize(Math.round(b.width), Math.round(b.height)));
        if (design && b.zoom !== zoom) {
          zoom = b.zoom;
          w.setZoom(zoom).catch(() => {});
        }
      };
      sync.current = place;
      ro = new ResizeObserver(place);
      ro.observe(box.current!);
      window.addEventListener("resize", place, { signal: ac.signal });
      place();
    })().catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
      ro?.disconnect();
      ac.abort();
      unlisten?.();
      window.clearTimeout(hideTimer);
      sync.current = undefined;
      view.current?.close();
      view.current = undefined;
    };
  }, [label, url, reload, box, script, design]);

  const show = visible && (!script || ready);
  useEffect(() => {
    const w = view.current;
    if (!w) return;
    sync.current?.();
    if (show) w.show().catch(() => {});
    // 还在画的后台页面只放屏幕外，hideTimer 到了才藏
    else if (!script || painted.current) w.hide().catch(() => {});
  }, [show, script]);

  return { error, ready };
}
