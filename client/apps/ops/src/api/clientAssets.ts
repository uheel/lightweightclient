import { api } from "@radar/core";

/**
 * 客户端自己的、按机构存的素材对应关系（楼栋图等），存在平台通用设置 /sapi/setting 机构层（scope 2）的一个键里。
 * 平台没有批量读接口，所以整个机构只用一个键，一次读回来在本地用。
 * 机构设置 /api/settings/org 会丢掉不认识的字段，不能放那里（见 docs/site-analysis.md"文件存储与通用设置"）。
 */

const KEY = "ops-client.assets";
const SCOPE_ORG = 2;

export interface ClientAssets {
  /** 楼栋 id → 图片文件 id */
  buildings?: Record<string, string>;
}

export async function getClientAssets(): Promise<ClientAssets> {
  const raw = (await api.get<string>("/sapi/setting", { params: { key: KEY, scope: SCOPE_ORG } })).data;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ClientAssets;
  } catch {
    return {};
  }
}

/** 改一项：写之前重新读一次再合并，减少两个人同时改时互相覆盖 */
export async function updateClientAssets(f: (cur: ClientAssets) => ClientAssets) {
  const next = f(await getClientAssets());
  await api.post("/sapi/setting", { key: KEY, value: JSON.stringify(next), scope: SCOPE_ORG });
  return next;
}

/** 设置或去掉一栋楼的图片，返回被换掉的旧文件 id（调用方去删） */
export async function setBuildingImage(buildingId: string, fileId: string | undefined) {
  let old: string | undefined;
  const next = await updateClientAssets((cur) => {
    const buildings = { ...cur.buildings };
    old = buildings[buildingId];
    if (fileId) buildings[buildingId] = fileId;
    else delete buildings[buildingId];
    return { ...cur, buildings };
  });
  return { next, old: old !== fileId ? old : undefined };
}
