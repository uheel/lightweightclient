import { useEffect, useRef, useState } from "react";
import { App, Button, Empty } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { isTauri } from "@radar/core";
import { linkUrl, useNames, type LinkKey } from "../workspace/names";
import { useChildWebview, useOverlayOpen } from "../workspace/childWebview";

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
  const { error } = useChildWebview(box, `link-${k}`, url, reload, active && !overlay);
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
