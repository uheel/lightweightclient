import { useEffect, useState } from "react";
import { isTauri } from "../http";

/**
 * 自绘的最小化 / 最大化 / 关闭按钮。
 * 只在窗口关掉了系统标题栏（tauri.conf.json 里 decorations: false）时显示，
 * 所以用户端还用系统标题栏时放着也不会多出一组按钮。
 */
export function WindowControls({ className }: { className?: string }) {
  const [frameless, setFrameless] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    let off: (() => void) | undefined;
    let dead = false;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      if (await w.isDecorated()) return;
      if (dead) return;
      setFrameless(true);
      setMaximized(await w.isMaximized());
      const un = await w.onResized(async () => setMaximized(await w.isMaximized()));
      if (dead) un();
      else off = un;
    })();
    return () => {
      dead = true;
      off?.();
    };
  }, []);

  if (!frameless) return null;

  const run = async (fn: "minimize" | "toggleMaximize" | "close") => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow()[fn]();
  };

  return (
    <div className={`win-ctrl${className ? ` ${className}` : ""}`}>
      <button type="button" aria-label="最小化" title="最小化" onClick={() => run("minimize")}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5.5h10" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? "还原" : "最大化"}
        title={maximized ? "还原" : "最大化"}
        onClick={() => run("toggleMaximize")}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none" stroke="currentColor">
            <rect x="0.5" y="2.5" width="7" height="7" />
            <path d="M2.5 2.5V0.5h7v7h-2" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none" stroke="currentColor">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button type="button" className="win-close" aria-label="关闭" title="关闭" onClick={() => run("close")}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden stroke="currentColor">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
