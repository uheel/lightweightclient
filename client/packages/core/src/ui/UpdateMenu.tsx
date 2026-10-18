import { useCallback, useEffect, useRef, useState } from "react";
import { App, Badge, Modal, Progress, type MenuProps } from "antd";
import { CloudDownloadOutlined, InfoCircleOutlined, SyncOutlined } from "@ant-design/icons";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "../http";

/** 启动后等一会儿再查（不和登录后的首屏请求抢），之后每 6 小时查一次 */
const FIRST_CHECK_MS = 8_000;
const CHECK_EVERY_MS = 6 * 3600_000;

/**
 * 自动更新：更新源是 tauri.conf.json 里 plugins.updater.endpoints（R2 上的 latest.json），
 * 安装包由 scripts/release.mjs 打包、签名、上传。
 * 后台定时检查只在发现新版本时标红点；菜单里"检查更新"是手动检查，查不到也给提示。
 */
export function useUpdater() {
  const { message } = App.useApp();
  const [version, setVersion] = useState<string>();
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  /** 下载进度 0-100；undefined 表示还没开始下载 */
  const [percent, setPercent] = useState<number>();
  const busy = useRef(false);

  const run = useCallback(
    async (manual: boolean) => {
      if (!isTauri || busy.current) return;
      busy.current = true;
      setChecking(true);
      try {
        const u = await check({ timeout: 20_000 });
        setUpdate(u);
        if (manual) {
          if (u) setOpen(true);
          else message.success("已是最新版本");
        }
      } catch (e) {
        if (manual) message.error(`检查更新失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        busy.current = false;
        setChecking(false);
      }
    },
    [message],
  );

  useEffect(() => {
    if (!isTauri) return;
    getVersion().then(setVersion).catch(() => {});
    // 开发模式不自动查（dev 的版本号没意义），手动检查仍可用来调试
    if (import.meta.env.DEV) return;
    const first = setTimeout(() => run(false), FIRST_CHECK_MS);
    const timer = setInterval(() => run(false), CHECK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [run]);

  const install = async () => {
    if (!update) return;
    let total = 0;
    let got = 0;
    setPercent(0);
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          if (total) setPercent(Math.min(99, Math.round((got / total) * 100)));
        } else setPercent(100);
      });
      // Windows 上安装程序会自己关掉客户端再装；其他平台装完手动重启
      await relaunch();
    } catch (e) {
      setPercent(undefined);
      message.error(`更新失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 插到用户菜单里的两项：当前版本、检查更新 / 发现新版本 */
  const menu: MenuProps["items"] = isTauri
    ? [
        { key: "__version", icon: <InfoCircleOutlined />, label: `当前版本 v${version ?? "…"}`, disabled: true },
        update
          ? {
              key: "__update",
              icon: <CloudDownloadOutlined />,
              label: (
                <Badge dot offset={[6, 2]}>
                  发现新版本 v{update.version}
                </Badge>
              ),
              onClick: () => setOpen(true),
            }
          : {
              key: "__update",
              icon: <SyncOutlined spin={checking} />,
              label: checking ? "正在检查更新…" : "检查更新",
              disabled: checking,
              onClick: () => run(true),
            },
      ]
    : [];

  const downloading = percent !== undefined;
  const dialog = (
    <Modal
      open={open && !!update}
      title={`发现新版本 v${update?.version ?? ""}`}
      okText={downloading ? "正在更新…" : "立即更新"}
      cancelText="稍后"
      onOk={install}
      okButtonProps={{ loading: downloading }}
      cancelButtonProps={{ disabled: downloading }}
      closable={!downloading}
      maskClosable={!downloading}
      onCancel={() => setOpen(false)}
      width={440}
    >
      <p style={{ color: "#8A8FA8", margin: "4px 0 12px" }}>
        当前版本 v{version}
        {update?.date ? ` · 发布于 ${update.date.slice(0, 10)}` : ""}
      </p>
      {update?.body && <div style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto", marginBottom: 12 }}>{update.body}</div>}
      {downloading ? (
        <Progress percent={percent} size="small" />
      ) : (
        <p style={{ color: "#8A8FA8", margin: 0 }}>更新时客户端会自动关闭，安装完成后重新打开。</p>
      )}
    </Modal>
  );

  return { menu, hasUpdate: !!update, dialog };
}
