import { useSyncExternalStore } from "react";
import { isTauri } from "@radar/core";
import { compressImage, deleteFile, fileUrl, uploadFile } from "../api/files";
import { getClientAssets, updateClientAssets, type ClientAssets } from "../api/clientAssets";

/**
 * 客户端的名称和 Logo（系统设置里改）：按机构存在平台，登录后读当前机构的。
 * 登录页还不知道是哪个机构，所以本机缓存一份最后用过的，登录页和启动时先显示它。
 * 安装包、exe 的名字和桌面图标是打包时定的，这里改不了。
 */
export const DEFAULT_NAME = "Radar Config";
const DEFAULT_LOGO = "/logo.svg";
/** 名字最长几个字，太长标题栏放不下 */
export const BRAND_NAME_MAX = 12;
/** 上传时的最长边。读的时候不用服务器缩图（?w=）：缩出来透明的地方会变黑 */
const LOGO_EDGE = 256;

const KEY = "ops.brand";

/** name、logo（图片地址）没有就是默认 */
type Cached = { name?: string; logo?: string };

function load(): Cached {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Cached;
  } catch {
    return {};
  }
}

let current = load();
const listeners = new Set<() => void>();

function apply(b: ClientAssets["brand"]) {
  current = { name: b?.name, logo: b?.logo ? fileUrl(b.logo) : undefined };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* 存不了只是下次登录页显示旧的 */
  }
  listeners.forEach((f) => f());
}

let seq = 0;

/** 读当前机构的设置；读失败就继续用缓存的。连着切机构时只用最后一次的结果 */
export async function refreshBrand() {
  const my = ++seq;
  const assets = await getClientAssets().catch(() => undefined);
  if (assets && my === seq) apply(assets.brand);
}

/** 改一项，返回写之前的 Logo 文件 id */
async function update(patch: NonNullable<ClientAssets["brand"]>) {
  let old: string | undefined;
  const next = await updateClientAssets((cur) => {
    old = cur.brand?.logo;
    return { ...cur, brand: { ...cur.brand, ...patch } };
  });
  seq++;
  apply(next.brand);
  return old;
}

/** 改名字；空白恢复默认 */
export async function saveBrandName(name: string) {
  await update({ name: name.trim() || undefined });
}

/** 换 Logo：上传新图、改对应关系，再删掉换下来的旧文件 */
export async function saveBrandLogo(file: File) {
  const id = await uploadFile(await compressImage(file, LOGO_EDGE, 0.9), "客户端Logo.webp");
  const old = await update({ logo: id });
  if (old) deleteFile(old);
}

export async function resetBrandLogo() {
  const old = await update({ logo: undefined });
  if (old) deleteFile(old);
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

export function useBrand() {
  const b = useSyncExternalStore(subscribe, () => current);
  return { name: b.name || DEFAULT_NAME, logo: b.logo || DEFAULT_LOGO, customName: b.name, customLogo: !!b.logo };
}

/** 不在 React 里用：告警弹窗窗口读本机缓存的名字 */
export const brandName = () => current.name || DEFAULT_NAME;

/** 窗口标题（任务栏悬停、Alt+Tab 里看到的） */
export async function applyWindowTitle(name: string) {
  document.title = name;
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(name);
}

/** 图片在平台上被删了就显示默认 Logo */
export function BrandLogo({ size }: { size: number }) {
  const { logo } = useBrand();
  return (
    <img
      src={logo}
      alt=""
      width={size}
      height={size}
      style={{ objectFit: "contain", flex: "none" }}
      onError={(e) => {
        if (!e.currentTarget.src.endsWith(DEFAULT_LOGO)) e.currentTarget.src = DEFAULT_LOGO;
      }}
    />
  );
}
