import { api, assetUrl, session } from "@radar/core";

/**
 * 平台文件管理（系统管理 › 文件管理，/sapi/oss/*，见 docs/site-analysis.md"文件存储与通用设置"）。
 * 客户端上传的文件都放在当前机构根目录下 serviceKey 为 ops-client 的文件夹里（名字用户可以改，按 serviceKey 找）。
 * 读文件不用登录，地址里只有文件 id；平台让浏览器缓存一年，所以文件从不原地替换：换图 = 传新文件 + 删旧文件。
 */

const SERVICE_KEY = "ops-client";
const FOLDER_NAME = "运维端";

interface OssItem {
  id: string;
  osName: string;
  /** 1 文件夹，2 文件 */
  osType: number;
  serviceKey?: string;
  createdAt?: string;
}

/** 按机构缓存文件夹 id */
const folders = new Map<string, Promise<string>>();

async function findOrCreateFolder() {
  const root = await api.getAll<OssItem>("/sapi/oss/pages", { filter: { platform: false }, pageSize: 200, max: 2000 });
  // 两台客户端同时第一次上传可能各建一个，取最早的那个
  const hit = (root.data ?? []).filter((x) => x.osType === 1 && x.serviceKey === SERVICE_KEY).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))[0];
  if (hit) return hit.id;
  return (await api.post<string>("/sapi/oss/folder", { osName: FOLDER_NAME, serviceKey: SERVICE_KEY })).data!;
}

function folderId() {
  const org = session.get()?.orgId ?? "";
  let p = folders.get(org);
  if (!p) {
    p = findOrCreateFolder();
    folders.set(org, p);
    p.catch(() => folders.delete(org));
  }
  return p;
}

/** 上传到当前机构，返回文件 id。缓存的文件夹可能已经在平台上被删掉，失败时重新找一次文件夹再传 */
export async function uploadFile(file: Blob, name: string) {
  const send = async () => {
    const fd = new FormData();
    fd.append("file", file, name);
    fd.append("folderId", await folderId());
    return (await api.upload<string>("/sapi/oss/upload", fd)).data!;
  };
  try {
    return await send();
  } catch {
    folders.delete(session.get()?.orgId ?? "");
    return send();
  }
}

/** 删除文件；已经不在了也不报错 */
export async function deleteFile(id: string) {
  await api.del("/sapi/oss", { params: { id } }).catch(() => {});
}

/** 图片地址：w 是服务器缩图宽度（按显示尺寸的 2 倍取，高分屏也清楚） */
export function fileUrl(id: string, w?: number) {
  return assetUrl(`/sapi/oss/${id}${w ? `?w=${w}` : ""}`);
}

/**
 * 上传前压缩：最长边不超过 maxEdge，转成 webp。照片原图常有几 MB，楼栋卡片只要几十 KB。
 * 原图本来就小于目标尺寸也照样转一遍，顺便去掉照片里的 EXIF（拍摄位置等）
 */
export async function compressImage(file: File, maxEdge = 1600, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", quality));
  if (!blob) throw new Error("图片处理失败");
  return blob;
}

/** 选图对话框接受的格式（平台允许的图片后缀里浏览器能解码的） */
export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif";
