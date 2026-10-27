import { useEffect, useRef, useState } from "react";
import { App, Button, Empty } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { isTauri } from "@radar/core";
import { linkUrl, useNames, type LinkKey } from "../workspace/names";

/** 在单独的窗口里打开 */
async function openWindow(k: LinkKey, url: string, title: string) {
  if (!isTauri) return void window.open(url, "_blank", "noopener");
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = `link-${k}`;
  const old = await WebviewWindow.getByLabel(label);
  if (old) {
    await old.setFocus();
    return;
  }
  new WebviewWindow(label, { url, title, width: 1200, height: 800, center: true });
}

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
function useOverlayOpen(enabled: boolean) {
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

/**
 * 桌面端：在主窗口里另开一个子 webview 显示网址，跟着占位框的位置和大小走。子 webview 是独立的浏览器视图、不是嵌在页面里，
 * 网站设了 X-Frame-Options / frame-ancestors 也照样能显示。标签不在前台或有弹层时藏起来，关标签时关掉
 */
function useChildWebview(box: React.RefObject<HTMLDivElement | null>, k: LinkKey, url: string | undefined, reload: number, visible: boolean) {
  const view = useRef<import("@tauri-apps/api/webview").Webview>(undefined);
  const [error, setError] = useState<string>();
  const shown = useRef(visible);
  shown.current = visible;

  // 网址变了或点了重新加载：关掉旧的、建新的
  useEffect(() => {
    if (!isTauri || !url || !box.current) return;
    let dead = false;
    let ro: ResizeObserver | undefined;
    const ac = new AbortController();
    setError(undefined);
    (async () => {
      const [{ Webview }, { getCurrentWindow }, { LogicalPosition, LogicalSize }] = await Promise.all([
        import("@tauri-apps/api/webview"),
        import("@tauri-apps/api/window"),
        import("@tauri-apps/api/dpi"),
      ]);
      if (dead || !box.current) return;
      const rect = () => box.current!.getBoundingClientRect();
      const r = rect();
      const w = new Webview(getCurrentWindow(), `link-${k}-${Date.now().toString(36)}`, {
        url,
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.max(1, Math.round(r.width)),
        height: Math.max(1, Math.round(r.height)),
      });
      w.once("tauri://error", (e) => !dead && setError(String(e.payload)));
      await new Promise<void>((resolve) => void w.once("tauri://created", () => resolve()));
      if (dead) return void w.close();
      view.current = w;
      if (!shown.current) await w.hide();
      // 占位框挪动或变大小（拖窗口、开关快速开始横幅等）时跟着走
      const sync = () => {
        const b = rect();
        if (!b.width || !b.height) return;
        w.setPosition(new LogicalPosition(Math.round(b.left), Math.round(b.top)));
        w.setSize(new LogicalSize(Math.round(b.width), Math.round(b.height)));
      };
      ro = new ResizeObserver(sync);
      ro.observe(box.current!);
      window.addEventListener("resize", sync, { signal: ac.signal });
      sync();
    })().catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
      ro?.disconnect();
      ac.abort();
      view.current?.close();
      view.current = undefined;
    };
  }, [k, url, reload, box]);

  useEffect(() => {
    const w = view.current;
    if (w) (visible ? w.show() : w.hide()).catch(() => {});
  }, [visible]);

  return error;
}

/** 标签右键菜单里的"重新加载""新窗口打开"：页面上不放工具栏，网页占满整个标签 */
const actions = new EventTarget();
export function linkAction(k: LinkKey, action: "reload" | "window") {
  actions.dispatchEvent(new CustomEvent(action, { detail: k }));
}

/** 链接模块：在标签里显示菜单设置里填的第三方网址（桌面端用子 webview，浏览器里用 iframe） */
export default function LinkPage({ k, active }: { k: LinkKey; active: boolean }) {
  const { message } = App.useApp();
  const names = useNames();
  const link = names.link(k);
  const url = linkUrl(link?.url);
  // 改了 key 就重新加载
  const [reload, setReload] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const overlay = useOverlayOpen(isTauri && active && !!url);
  const error = useChildWebview(box, k, url, reload, active && !overlay);
  const title = names.module(k);

  useEffect(() => {
    if (!url) return;
    const mine = (e: Event) => (e as CustomEvent<LinkKey>).detail === k;
    const onReload = (e: Event) => mine(e) && setReload((n) => n + 1);
    const onWindow = (e: Event) =>
      mine(e) && openWindow(k, url, title).catch((err) => message.error(`打开窗口失败：${err instanceof Error ? err.message : String(err)}`));
    actions.addEventListener("reload", onReload);
    actions.addEventListener("window", onWindow);
    return () => {
      actions.removeEventListener("reload", onReload);
      actions.removeEventListener("window", onWindow);
    };
  }, [k, url, title, message]);

  if (!link) return <Empty style={{ marginTop: 80 }} description="这个链接模块已经在菜单设置里删掉了，关掉这个标签就行" />;
  if (!url) return <Empty style={{ marginTop: 80 }} description={link.url.trim() ? `"${link.url}" 不像网址，到菜单设置里改一下` : "还没填网址，到菜单设置里填"} />;

  return (
    <div className="link-page">
      {isTauri ? (
        // 占位：子 webview 盖在这块上面；没建成时这里显示原因
        <div ref={box} className="link-frame">
          {error && (
            <Empty
              style={{ marginTop: 80 }}
              description={
                <>
                  打不开：{error}
                  <br />
                  <Button size="small" type="link" icon={<ReloadOutlined />} onClick={() => setReload((n) => n + 1)}>
                    重新加载
                  </Button>
                </>
              }
            />
          )}
        </div>
      ) : (
        <iframe key={`${url}#${reload}`} className="link-frame" src={url} title={names.module(k)} referrerPolicy="no-referrer" />
      )}
    </div>
  );
}
