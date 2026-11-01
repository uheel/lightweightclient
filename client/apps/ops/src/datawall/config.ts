import { useSyncExternalStore } from "react";
import { WALL_PAGES, type WallPageDef } from "./pages";

/** 魔墙设置：轮播开关、各页面的显示、顺序、停留时间。存在这台电脑上，所有机构共用（和菜单设置一样） */

export interface WallPageConfig {
  key: string;
  enabled: boolean;
  /** 停留秒数；全房间看板是每屏 */
  seconds: number;
}

export interface WallConfig {
  carousel: boolean;
  pages: WallPageConfig[];
}

export const MIN_SECONDS = 5;
export const MAX_SECONDS = 600;
const defaultSeconds = (d: WallPageDef) => (d.kind === "rooms" ? 20 : 30);

const KEY = "ops.dataWall.config";

export const defaultConfig = (): WallConfig => ({ carousel: true, pages: WALL_PAGES.map((d) => ({ key: d.key, enabled: true, seconds: defaultSeconds(d) })) });

/** 存的配置和页面表对上：删掉的页面去掉，新加的页面排在最后；一页都不显示时恢复默认 */
function normalize(saved: Partial<WallConfig>): WallConfig {
  const base = defaultConfig();
  const known = new Map(base.pages.map((p) => [p.key, p]));
  const kept = (saved.pages ?? []).filter((p) => known.has(p.key)).map((p) => ({ ...known.get(p.key)!, ...p }));
  const keys = new Set(kept.map((p) => p.key));
  const pages = [...kept, ...base.pages.filter((p) => !keys.has(p.key))];
  return { carousel: saved.carousel ?? base.carousel, pages: pages.some((p) => p.enabled) ? pages : base.pages };
}

let current: WallConfig = (() => {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<WallConfig>);
  } catch {
    return defaultConfig();
  }
})();

const listeners = new Set<() => void>();

export function setWallConfig(next: WallConfig) {
  current = normalize(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* 存不下就只在这次打开时有效 */
  }
  for (const l of listeners) l();
}

export function useWallConfig() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export type WallPage = WallPageDef & { seconds: number };

/** 魔墙要显示的页面，按设置的顺序 */
export function enabledPages(c: WallConfig): WallPage[] {
  const defs = new Map(WALL_PAGES.map((d) => [d.key, d]));
  return c.pages.filter((p) => p.enabled).map((p) => ({ ...defs.get(p.key)!, seconds: p.seconds }));
}
