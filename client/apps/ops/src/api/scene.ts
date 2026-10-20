import { api, realtime } from "@radar/core";
import { isResponseOk, type DeviceResponse } from "./device";
import type { PlanElement } from "./room";
import { installAreaOf } from "../rooms/installArea";

/** 场景模板与设备场景（接口说明见 docs/site-analysis.md"场景模板与设备场景"） */

export interface SceneCondition {
  id?: string;
  property?: string;
  /** REAL 直接比较 target；COUNT 时 countOperator/countTarget 是取值比较，operator/target 是次数门槛 */
  aggregation?: string;
  /** 统计最近几条记录 */
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
 * 当前机构可用的全部模板（含平台模板），停用的不要。
 * includePlatfrom（平台原拼写）必须写成 filter[includePlatfrom]=true，写成普通参数时子机构账号、切到子机构的管理员都查不到平台模板。
 */
export async function getSceneTemplates() {
  const res = await api.get<SceneTemplate[]>("/api/scene-template/pages", {
    params: { current: 1, pageSize: 1000 },
    filter: { includePlatfrom: true, isDisabled: false },
  });
  return (res.data ?? []).filter((t) => !t.isDisabled);
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
 * 从设备读回场景（IOT.gettact），30 秒超时。平台网页端两种推送都认、只按 sn 对：
 * DeviceConfigChange {sn, command:"read", data:{scenes}}（实测走的是这个），或 DeviceResponse {sn, command:"get-tact", code, data:[...]}。
 * 平台记录可能和设备不一致（例如删掉设备再添加，新设备 id 下没有记录，设备上的场景还在）。
 */
export function readDeviceScenes(sn: string, timeoutMs = 30_000) {
  return new Promise<Scene[]>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      offs.forEach((off) => off());
      clearTimeout(timer);
      fn();
    };
    const list = (v: unknown) => (Array.isArray(v) ? (v as Scene[]) : []);
    const offs = [
      realtime.on("DeviceConfigChange", (payload) => {
        const r = payload as { sn?: string; command?: string; data?: { scenes?: unknown } };
        if (r?.sn === sn && r.command === "read") finish(() => resolve(list(r.data?.scenes)));
      }),
      realtime.on("DeviceResponse", (payload) => {
        const r = payload as DeviceResponse;
        if (r?.sn !== sn || r.command !== "get-tact") return;
        finish(() => (isResponseOk(r.code) ? resolve(list(r.data)) : reject(new Error(`${r.message || "设备返回错误"}（code ${r.code}）`))));
      }),
    ];
    const timer = window.setTimeout(() => finish(() => reject(new Error("30 秒内设备没有应答，请确认设备在线"))), timeoutMs);
    api.post<unknown>("/api/device-scene/read", { sn }).catch((e) => finish(() => reject(e)));
  });
}

/**
 * 合并平台记录和设备读回的场景，规则同平台网页端：按场景名对上，同名的用设备上的内容、保留平台的 id；只在设备上有的追加在后面。
 * 只在平台上有的保留（平台网页端也是这样）。
 */
export function mergeDeviceScenes(platform: Scene[], device: Scene[]) {
  if (!device.length) return platform;
  const names = new Set(platform.map((s) => s.sceneName));
  return [
    ...platform.map((p) => {
      const d = device.find((x) => x.sceneName === p.sceneName);
      return d ? { ...d, id: p.id, sceneName: p.sceneName, isDisabled: false } : p;
    }),
    ...device.filter((d) => !names.has(d.sceneName)).map((d) => ({ ...d, isDisabled: false })),
  ];
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

export type SendState = { status: "waiting" | "sending" | "ok" | "fail"; text?: string };

/** 下发后等设备应答：轮询下发状态，直到时间变了且不再是"等待" */
export async function waitIssued(deviceId: string, before: string | undefined, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await getSceneIssueStatus(deviceId);
    if (s.sceneIssueAt && s.sceneIssueAt !== before && s.sceneIssueStatus !== 1) {
      return s.sceneIssueStatus === 2 ? ({ status: "ok", text: s.sceneIssueAt } as SendState) : ({ status: "fail", text: s.sceneIssueError || "设备返回错误" } as SendState);
    }
  }
  return { status: "fail", text: "30 秒内设备没有应答" } as SendState;
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
  /** 雷达安装区域（字典 RADAR_INSTALL_AREA）：1 卧室，2 客厅，3 厨房，7 卫生间，9 其他 */
  installArea?: number;
  ranges: LayoutRange[];
}

interface LayoutElement {
  type: number;
  sn?: string;
  rangeType?: number | null;
  rangeName?: string | null;
  qingLanConfig?: { ranges?: { index?: number; type: number; text?: string; spaceType?: number }[]; extra?: { installArea?: string | number | null; installAreaAlias?: string | null } };
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
          installArea: installAreaOf(e as PlanElement)?.type,
          // 区域号 = 位置（平台下发按位置编号，存的 index 可能有空号），见 rooms/qinglan.ts zonesOf
          ranges: (e.qingLanConfig?.ranges ?? []).map((r, i) => ({ index: i, type: r.type, text: r.text, spaceType: r.spaceType })),
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
export { INSTALL_AREA } from "../rooms/installArea";
