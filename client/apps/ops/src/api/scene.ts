import { api, session } from "@radar/core";

/** 场景模板与设备场景（接口说明见 docs/site-analysis.md"场景模板与设备场景"） */

export interface SceneCondition {
  id?: string;
  property?: string;
  /** REAL 直接比较 target；COUNT 时 countOperator/countTarget 是取值比较，operator/target 是次数门槛 */
  aggregation?: string;
  /** 时间窗口，秒 */
  range?: string;
  operator?: string;
  target?: string;
  countOperator?: string;
  countTarget?: string;
  [k: string]: unknown;
}

export interface SceneAction {
  id?: string;
  name?: string;
  type?: string;
  [k: string]: unknown;
}

/** 平台的场景对象，下发时平台转成设备的 scene_config */
export interface Scene {
  id?: string;
  sceneName: string;
  isDisabled?: boolean;
  conditionType?: string;
  conditions?: SceneCondition[];
  actions?: SceneAction[];
  interExpression?: string;
  exitExpression?: string;
  [k: string]: unknown;
}

export interface SceneTemplate {
  id: string;
  templateName: string;
  deviceType: number;
  sceneGroupName?: string;
  isDisabled?: boolean;
  updatedAt?: string;
}

/**
 * 全部可用模板，停用的不要。
 * 模板按机构存：平台建的模板在账号的所属机构（rawOrgId，例如"平台"）下，切到子机构后按子机构查不到，
 * 所以当前机构和所属机构各查一次再合并。按 id 取模板内容不受机构限制。
 */
export async function getSceneTemplates() {
  const s = session.get();
  const orgs = s && s.rawOrgId && s.rawOrgId !== s.orgId ? [undefined, { orgId: s.rawOrgId, orgType: s.orgType }] : [undefined];
  const lists = await Promise.all(
    orgs.map((org) =>
      api.get<SceneTemplate[]>("/api/scene-template/pages", {
        params: { current: 1, pageSize: 1000, includePlatfrom: true, isDisabled: false },
        org,
      }),
    ),
  );
  const byId = new Map<string, SceneTemplate>();
  for (const r of lists) for (const t of r.data ?? []) if (!t.isDisabled) byId.set(t.id, t);
  return [...byId.values()];
}

const configCache = new Map<string, Promise<Scene | undefined>>();

/** 模板里的场景定义（同一模板只取一次） */
export function getTemplateScene(templateId: string) {
  let p = configCache.get(templateId);
  if (!p) {
    p = api
      .get<{ sceneConfig?: Scene }>("/api/scene-template/config", { params: { templateId } })
      .then((r) => r.data?.sceneConfig);
    p.catch(() => configCache.delete(templateId));
    configCache.set(templateId, p);
  }
  return p;
}

/** 设备当前场景（平台库里的记录） */
export async function getDeviceScenes(deviceId: string) {
  return (await api.get<Scene[]>("/api/device-scene/scene", { params: { deviceId } })).data ?? [];
}

/**
 * 保存并下发设备场景。整体覆盖：列表里没有的场景会被删除。
 * 返回下发指令的 seq。
 */
export async function saveDeviceScenes(sn: string, scenes: Scene[]) {
  return (await api.post<number>("/api/device-scene/scene", { sn, scenes, saveOnly: false, clear: true })).data;
}

/** 下发状态：1 等待设备应答，2 成功，3 失败 */
export interface SceneIssueStatus {
  sceneIssueStatus?: number;
  sceneIssueAt?: string;
  sceneIssueError?: string;
}

export async function getSceneIssueStatus(deviceId: string) {
  return (await api.get<SceneIssueStatus>("/api/device-config/scene-status", { params: { deviceId } })).data ?? {};
}

// ---------- 房间布局：区域与雷达安装区域 ----------

export interface LayoutRange {
  /** 下发给设备的区域编号，从 0 开始 */
  index: number;
  /** 2 普通床，3 干扰区，4 门，5 监护床，6 感应区，7 家具 */
  type: number;
  text?: string;
  /** 空间区域类型（字典 ROOM_SPACE_TYPE），56 马桶、57 淋浴等 */
  spaceType?: number;
}

export interface RadarLayout {
  /** 雷达安装区域（字典 RADAR_INSTALL_AREA）：1 卧室，2 客厅，3 卫生间，4 厨房，5 其他 */
  installArea?: number;
  ranges: LayoutRange[];
}

interface LayoutElement {
  type: number;
  sn?: string;
  rangeType?: number;
  qingLanConfig?: { ranges?: { index?: number; type: number; text?: string; spaceType?: number }[] };
  children?: LayoutElement[];
}

/** 房间里每台雷达的区域列表，sn → 布局 */
export async function getRoomLayouts(roomId: string) {
  const d = (await api.get<{ elements?: LayoutElement[] }>("/api/room-view/v3/detail", { params: { roomId } })).data;
  const out = new Map<string, RadarLayout>();
  const walk = (list?: LayoutElement[]) => {
    for (const e of list ?? []) {
      if (e.type === 3 && e.sn) {
        out.set(e.sn, {
          installArea: e.rangeType,
          ranges: (e.qingLanConfig?.ranges ?? []).map((r, i) => ({ index: r.index ?? i, type: r.type, text: r.text, spaceType: r.spaceType })),
        });
      }
      walk(e.children);
    }
  };
  walk(d?.elements);
  return out;
}

export const SPACE_TYPE: Record<number, string> = {
  51: "床", 52: "沙发", 53: "过道", 54: "会客", 55: "餐厅", 56: "马桶", 57: "淋浴", 58: "洗漱", 59: "更衣", 60: "阅读",
};
export const RANGE_TYPE: Record<number, string> = { 2: "普通床", 3: "干扰区", 4: "门", 5: "监护床", 6: "感应区", 7: "家具" };
export const INSTALL_AREA: Record<number, string> = { 1: "卧室", 2: "客厅", 3: "卫生间", 4: "厨房", 5: "其他" };
