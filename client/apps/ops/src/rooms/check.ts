import type { Radar, StoredProperty } from "../api/device";
import { radarElements, type PlanElement, type Room, type RoomDesign } from "../api/room";
import type { Scene } from "../api/scene";
import { AREA_NEED, templateAreaValues } from "../scenes/plan";
import { describeDiff, sameArray, toDeviceArrays, validate, ZONE_TYPE, zonesOf, type DeviceArrays, type Issue, type QlConfig } from "./qinglan";

/**
 * 房间诊断：只用已经取回的数据在本地判断，不再请求平台。
 * 平台记录（property-schema-values）不能证明设备已生效：保存房间布置时平台会把记录改成新值，下发状态却不变。
 * 所以"记录一致"只说明平台这边对得上，设备上是什么要读设备才知道。
 */

/** 能配区域的型号：6 AIO，13 Ultra 跌倒，15 Ultra Plus */
export const ZONE_TYPES = new Set([6, 13, 15]);

export type Level = "ok" | "warn" | "error" | "none";

/** 平台记录和房间布置算出来的数组比，结果是什么 */
export type RecordState = "match" | "differs" | "never" | "failed" | "sending";

export const RECORD_TEXT: Record<RecordState, string> = {
  match: "平台记录一致",
  differs: "设备和布置不一致",
  never: "从没下发过",
  failed: "上次下发失败",
  sending: "下发中",
};

export interface RadarReport {
  sn: string;
  /** 本机构设备列表里的这台设备（布置里的 SN 找不到设备时没有） */
  device?: Radar;
  /** 房间布置里的雷达元素（设备绑了房间却没画进布置时没有） */
  element?: PlanElement;
  config?: QlConfig;
  /** 按房间布置算出来、应该在设备上的数组 */
  expected?: DeviceArrays;
  record?: { state: RecordState; config?: StoredProperty; area?: StoredProperty };
  issues: Issue[];
  level: Level;
  /** 布置里的空雷达位置（没装设备），等装设备时沿用，不算问题 */
  placeholder?: boolean;
}

export interface RoomReport {
  room: Room;
  design?: RoomDesign;
  radars: RadarReport[];
  /** 房间本身的问题（例如布置读取失败） */
  issues: Issue[];
  level: Level;
}

const RANK: Record<Level, number> = { none: 0, ok: 1, warn: 2, error: 3 };
export const worst = (ls: Level[]): Level => ls.reduce<Level>((a, b) => (RANK[b] > RANK[a] ? b : a), "none");
const levelOf = (issues: Issue[]): Level => (issues.some((i) => i.level === "error") ? "error" : issues.length ? "warn" : "ok");

function recordState(expected: DeviceArrays, values?: Record<string, StoredProperty>): RadarReport["record"] {
  const config = values?.QL_radar_config;
  const area = values?.QL_radar_area;
  if (!config && !area) return { state: "never" };
  if (config?.deliveryStatus === 3 || area?.deliveryStatus === 3) return { state: "failed", config, area };
  if (config?.deliveryStatus === 1 || area?.deliveryStatus === 1) return { state: "sending", config, area };
  const same = sameArray(config?.value, expected.config) && sameArray(area?.value ?? [], expected.area);
  return { state: same ? "match" : "differs", config, area };
}

/** 场景里引用的区域对不对：离床这类按"该用哪种区域"判断，其他的至少要是存在的区域 */
export function sceneIssues(scenes: Scene[], config?: QlConfig): Issue[] {
  const zones = config ? zonesOf(config) : [];
  const out: Issue[] = [];
  for (const s of scenes) {
    if (s.isDisabled) continue;
    const values = templateAreaValues(s);
    if (!values.length) continue;
    const name = `场景"${s.sceneName}"`;
    if (values.includes("{{area}}")) {
      out.push({ level: "error", text: `${name}的区域还是占位符 {{area}}，没有换成区域 ID` });
      continue;
    }
    if (!config) {
      out.push({ level: "error", text: `${name}用到了区域，但房间布置里没有这台雷达的区域` });
      continue;
    }
    const need = AREA_NEED[s.sceneName];
    const label = (v: string) => {
      const z = zones.find((x) => String(x.index) === v);
      return z ? `区域 ${v}（${z.text || ZONE_TYPE[z.type] || "未知类型"}）` : `区域 ${v}（不存在）`;
    };
    if (need) {
      const z = zones.find(need.match);
      if (!z) out.push({ level: "error", text: `${name}需要${need.label}，但布置里没有` });
      else if (values.some((v) => v !== String(z.index)))
        out.push({ level: "error", text: `${name}看的是${values.map(label).join("、")}，应该是${need.label}（区域 ${z.index}）`, zone: z.index });
      continue;
    }
    const missing = values.filter((v) => !zones.some((z) => String(z.index) === v));
    if (missing.length) out.push({ level: "error", text: `${name}引用的${missing.map(label).join("、")}在布置里找不到` });
  }
  return out;
}

export function checkRoom(opts: {
  room: Room;
  design?: RoomDesign;
  designError?: string;
  /** 本机构全部雷达 */
  devices: Radar[];
  /** sn → 平台记录的属性值 */
  values: Map<string, Record<string, StoredProperty>>;
  /** 设备 id → 设备场景 */
  scenes: Map<string, Scene[]>;
  /** sn → 布置里放了这台雷达的房间（查同一台雷达出现在多个房间的布置里） */
  layoutRooms?: Map<string, Room[]>;
}): RoomReport {
  const { room, design, designError, devices, values, scenes, layoutRooms } = opts;
  const bySn = new Map(devices.map((d) => [d.sn, d]));
  const issues: Issue[] = designError ? [{ level: "error", text: `房间布置读取失败：${designError}` }] : [];
  const radars: RadarReport[] = [];
  const drawn = new Set<string>();

  for (const e of radarElements(design)) {
    const sn = e.sn ?? "";
    if (sn) drawn.add(sn);
    const device = sn ? bySn.get(sn) : undefined;
    const r: RadarReport = { sn, device, element: e, issues: [], level: "ok" };
    // 设备在哪个房间以绑定（device.roomId）为准，布置里的雷达只是写着一个 sn，删设备、换绑都不会清理（docs/room-device-model.md）
    if (!sn) r.issues.push({ level: "warn", text: "布置里有一个没绑设备的雷达位置" });
    else if (!device) r.issues.push({ level: "warn", text: "布置里的雷达在本机构的设备里找不到（设备删了或转到别的机构，布置没清理）" });
    else if (!device.roomId)
      r.issues.push({ level: "warn", text: "这台雷达没绑定任何房间：布置里有它，但告警、长者、平台房间页都按绑定走，在那些地方它不属于这个房间" });
    else if (device.roomId !== room.id) r.issues.push({ level: "warn", text: `这台雷达已经绑到"${device.roomName ?? "别的房间"}"了，这里的布置是旧的` });
    const others = sn ? (layoutRooms?.get(sn) ?? []).filter((x) => x.id !== room.id) : [];
    if (others.length) r.issues.push({ level: "warn", text: `这台雷达还出现在 ${others.map((x) => `"${x.roomName}"`).join("、")} 的布置里，同一台雷达只该在一个房间` });

    const type = device?.deviceType ?? e.deviceType;
    if (type !== undefined && !ZONE_TYPES.has(type)) {
      r.level = "none";
      radars.push(r);
      continue;
    }
    if (!e.qingLanConfig) r.issues.push({ level: "error", text: "雷达放进了房间，但还没配安装方式和区域" });
    else {
      r.config = e.qingLanConfig;
      r.expected = toDeviceArrays(e.qingLanConfig);
      r.issues.push(...validate(e.qingLanConfig));
      if (device) {
        r.record = recordState(r.expected, values.get(sn));
        if (r.record?.state === "never") r.issues.push({ level: "warn", text: "这份布置还没下发过" });
        else if (r.record?.state === "failed") r.issues.push({ level: "error", text: "上次下发失败" });
        else if (r.record?.state === "differs") {
          const at = r.record.config?.deliveryAt ?? r.record.area?.deliveryAt;
          r.issues.push({
            level: "warn",
            text: `设备上的区域和房间布置不一样（平台记录${at ? ` ${at.slice(5, 16)}` : ""}）。在设备属性里直接改区域不会同步回布置；以布置为准就重新下发，以设备为准就把布置改成一样`,
            details: describeDiff(r.expected, r.record.config?.value, r.record.area?.value),
          });
        }
      }
    }
    if (device) r.issues.push(...sceneIssues(scenes.get(device.id) ?? [], r.config));
    r.level = levelOf(r.issues);
    radars.push(r);
  }

  // 设备绑在这个房间，布置里却没有
  for (const d of devices) {
    if (d.roomId !== room.id || drawn.has(d.sn)) continue;
    const zoned = d.deviceType === undefined || ZONE_TYPES.has(d.deviceType);
    const r: RadarReport = { sn: d.sn, device: d, issues: [], level: zoned ? "error" : "none" };
    if (zoned) {
      r.issues.push({ level: "error", text: "雷达绑在这个房间，但房间布置里没有它，区域没配", fix: "add-slot" });
      r.issues.push(...sceneIssues(scenes.get(d.id) ?? []));
    }
    radars.push(r);
  }

  const level = worst([levelOf(issues) === "ok" ? "none" : levelOf(issues), ...radars.map((r) => r.level)]);
  return { room, design, radars, issues, level };
}
