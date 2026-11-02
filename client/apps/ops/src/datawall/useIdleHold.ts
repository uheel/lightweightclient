import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@radar/core";

/** 多久看一次光标、看一次有没有到恢复时间 */
const POLL_MS = 500;

async function cursorInWindow() {
  const { cursorPosition, getCurrentWindow } = await import("@tauri-apps/api/window");
  const at = await cursorPosition();
  return { x: at.x, y: at.y, inside: async () => {
    const w = getCurrentWindow();
    const [pos, size] = await Promise.all([w.outerPosition(), w.outerSize()]);
    return at.x >= pos.x && at.y >= pos.y && at.x < pos.x + size.width && at.y < pos.y + size.height;
  } };
}

/**
 * 有人在操作时先不自动轮播：鼠标动、按键、点击、手动切换后 hold 为 true，seconds 秒没有动作再恢复。
 * 平台页面是盖在网页上的子 webview，鼠标在它上面移动时网页收不到事件，它又不能给客户端发消息，
 * 所以客户端里还要定时看系统光标位置；光标在窗口外移动不算（可能在用别的程序）。
 */
export function useIdleHold(enabled: boolean, seconds: number) {
  const [hold, setHold] = useState(false);
  const lastAction = useRef(0);
  const touch = useCallback(() => {
    if (!enabled) return;
    lastAction.current = Date.now();
    setHold(true);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return setHold(false);
    window.addEventListener("mousemove", touch);
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    let lastCursor: { x: number; y: number } | undefined;
    let polling = false;
    const t = setInterval(async () => {
      if (Date.now() - lastAction.current >= seconds * 1000) setHold(false);
      if (!isTauri || polling) return;
      polling = true;
      try {
        const c = await cursorInWindow();
        const moved = lastCursor && (lastCursor.x !== c.x || lastCursor.y !== c.y);
        lastCursor = { x: c.x, y: c.y };
        if (moved && (await c.inside())) touch();
      } catch {
        /* 取不到光标就只靠网页事件 */
      } finally {
        polling = false;
      }
    }, POLL_MS);
    return () => {
      clearInterval(t);
      window.removeEventListener("mousemove", touch);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [enabled, seconds, touch]);

  return { hold, touch };
}
