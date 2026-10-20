import { deviceLink } from "@radar/core";
import { getHeartbeats, getRadars, getStoredProperties, type Heartbeat, type Radar, type StoredProperty } from "../api/device";
import { getRoomDesign, radarElements, type Room, type RoomDesign } from "../api/room";
import { getDeviceScenes, type Scene } from "../api/scene";
import { getSpaces, type BedRow, type Building, type Floor } from "../api/space";
import { evaluate } from "../devices/angle";
import { checkRoom, sceneIssues, ZONE_TYPES, type RoomReport } from "../rooms/check";
import { pool } from "../scenes/plan";

/**
 * 快速开始：新机构从零配到能用的 7 步，每一步是否完成都用平台数据在本地判断（不靠用户打勾）。
 * 安装、布置、场景、体检这几步要逐台取心跳、场景、逐间取布置，和诊断页同一套数据，用 rooms/check.ts 的规则判断。
 */

export type NavKey = "devices" | "spaces" | "rooms" | "scenes" | "members" | "alerts" | "realtime";
export type StepKey = "spaces" | "radars" | "install" | "layout" | "scenes" | "members" | "diagnose";

/** 跳到哪个页面；id 是要选中的设备 / 房间，add 打开页面上的新建 */
export interface Target {
  nav: NavKey;
  id?: string;
  action?: "add";
}

export type StepStatus = "done" | "doing" | "todo" | "unknown";

export interface StepItem {
  text: string;
  target?: Target;
  /** 提示不算没完成 */
  tip?: boolean;
}

export interface Step {
  key: StepKey;
  title: string;
  /** 为什么要做这一步（没完成时显示） */
  why: string;
  status: StepStatus;
  /** 一行现状 */
  summary: string;
  items: StepItem[];
  /** 固定的参考说明 */
  note?: string;
  action: { label: string; target: Target };
}

type DesignState = { design?: RoomDesign; error?: string };

export interface GuideData {
  buildings: Building[];
  floors: Floor[];
  rooms: Room[];
  beds: BedRow[];
  radars: Radar[];
  /** 逐台、逐间取的数据；没取（轻量检查）时为空 */
  heavy?: {
    designs: Map<string, DesignState>;
    values: Map<string, Record<string, StoredProperty>>;
    scenes: Map<string, Scene[]>;
    heartbeats: Map<string, Heartbeat | undefined>;
    at: number;
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 机构不大时进来就做完整检查；大机构只在打开清单时做 */
export const isSmallOrg = (d: Pick<GuideData, "rooms" | "radars">) => d.rooms.length <= 150 && d.radars.length <= 80;

export async function loadGuideData(full: boolean | ((d: GuideData) => boolean), onProgress?: (done: number, total: number) => void): Promise<GuideData> {
  const [spaces, radars] = await Promise.all([getSpaces(), getRadars()]);
  const data: GuideData = { ...spaces, radars };
  if (!(typeof full === "function" ? full(data) : full)) return data;

  const active = radars.filter((d) => !d.isDisabled);
  const bound = active.filter((d) => d.roomId);
  const zoned = bound.filter((d) => d.deviceType === undefined || ZONE_TYPES.has(d.deviceType));
  const total = spaces.rooms.length + active.length + bound.length + zoned.length;
  let done = 0;
  const tick = () => onProgress?.(++done, total);
  onProgress?.(0, total);

  const designs = new Map<string, DesignState>();
  const values = new Map<string, Record<string, StoredProperty>>();
  const scenes = new Map<string, Scene[]>();
  const heartbeats = new Map<string, Heartbeat | undefined>();
  // 所有请求共用一个并发池，免得几类请求叠加起来同时打太多
  const jobs: (() => Promise<void>)[] = [
    ...spaces.rooms.map((r) => async () => {
      try {
        designs.set(r.id, { design: await getRoomDesign(r.id) });
      } catch (e) {
        designs.set(r.id, { error: errText(e) });
      }
    }),
    ...active.map((d) => async () => {
      const list = await getHeartbeats(d.sn, undefined, 8).catch(() => []);
      heartbeats.set(d.sn, list[list.length - 1]);
    }),
    ...bound.map((d) => async () => void scenes.set(d.id, await getDeviceScenes(d.id).catch(() => []))),
    ...zoned.map((d) => async () => void values.set(d.sn, await getStoredProperties(d.sn).catch(() => ({})))),
  ];
  await pool(jobs, 6, async (job) => {
    await job();
    tick();
  });
  data.heavy = { designs, values, scenes, heartbeats, at: Date.now() };
  return data;
}

const nameOf = (d: Radar) => d.deviceName || d.sn;
const where = (d: Radar) => d.roomName || "未绑定房间";
/** 没配安装方式时，偏差超过这么多就不说"超差多少"，直接说两种标准都对不上 */
const FAR_OFF = 20;
const maxDev = (ev: ReturnType<typeof evaluate>) => Math.max(...ev.axes.map((a) => Math.abs(a.dev)));
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}°`;
const minsAgo = (t: number, now: number) => {
  const m = Math.round((now - t) / 60e3);
  return m < 60 ? `${m} 分钟前` : m < 48 * 60 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`;
};

export const ANGLE_NOTE = "标准角度：顶装 x 0° · y 0° · z 90°；侧装 x 0° · y 68° · z 22°。三个角度都在 ±2° 以内算合格";

/** 按诊断页的规则算每间房；withScenes = false 时不查场景（布置这一步只看布置本身） */
function roomReports(data: GuideData, withScenes: boolean): RoomReport[] {
  const h = data.heavy!;
  const layoutRooms = new Map<string, Room[]>();
  for (const room of data.rooms) for (const e of radarElements(h.designs.get(room.id)?.design)) if (e.sn) layoutRooms.set(e.sn, [...(layoutRooms.get(e.sn) ?? []), room]);
  const scenes = withScenes ? h.scenes : new Map<string, Scene[]>();
  return data.rooms.map((room) => {
    const ds = h.designs.get(room.id);
    return checkRoom({ room, design: ds?.design, designError: ds?.error, devices: data.radars, values: h.values, scenes, layoutRooms });
  });
}

export function computeSteps(data: GuideData, now = Date.now()): Step[] {
  const { buildings, floors, rooms, beds, radars, heavy } = data;
  const active = radars.filter((d) => !d.isDisabled);
  const bound = active.filter((d) => d.roomId);
  const bedsOf = new Map<string, BedRow[]>();
  for (const b of beds) bedsOf.set(b.roomId, [...(bedsOf.get(b.roomId) ?? []), b]);
  const unknown = (s: Omit<Step, "status" | "summary" | "items">): Step => ({ ...s, status: "unknown", summary: "打开清单时检查", items: [] });

  // 1 建楼宇
  const s1 = ((): Step => {
    const base = { key: "spaces" as const, title: "建楼宇", why: "雷达、床位、长者都挂在房间上，先把楼栋 → 楼层 → 房间 → 床位建好。", action: { label: "去楼宇", target: { nav: "spaces" as const } } };
    const hint = "楼宇页左下角新建楼栋，再批量加楼层、批量加房间（写 301-310 这样的范围，可以顺便加床位）";
    if (!rooms.length) return { ...base, status: buildings.length ? "doing" : "todo", summary: buildings.length ? `${buildings.length} 栋楼，还没有房间` : "还没有楼栋", items: [{ text: hint, tip: true }] };
    if (!beds.length) return { ...base, status: "doing", summary: `${rooms.length} 间房，还没有床位`, items: [{ text: "在楼宇页点开房间加床位，批量加房间时也能每间带几张床", tip: true }] };
    const noBed = rooms.filter((r) => !bedsOf.has(r.id));
    return {
      ...base,
      status: "done",
      summary: `${buildings.length} 栋 · ${floors.length} 层 · ${rooms.length} 间房 · ${beds.length} 张床`,
      items: noBed.length ? [{ text: `${noBed.length} 间房没有床位（活动室这类可以不加）`, tip: true, target: { nav: "spaces", id: noBed[0]!.id } }] : [],
    };
  })();

  // 2 添加雷达
  const s2 = ((): Step => {
    const base = { key: "radars" as const, title: "添加雷达", why: "录入雷达的 SN 并选好房间，平台才知道这台雷达装在哪。", action: { label: "添加雷达", target: { nav: "devices" as const, action: "add" as const } } };
    if (!active.length)
      return { ...base, status: "todo", summary: "还没有雷达", items: rooms.length ? [] : [{ text: "建议先建好房间，添加时就能直接选房间", tip: true }] };
    const unbound = active.filter((d) => !d.roomId);
    if (unbound.length)
      return {
        ...base,
        status: "doing",
        summary: `${active.length} 台，${unbound.length} 台还没绑定房间`,
        items: unbound.map((d) => ({ text: `${nameOf(d)} · 未绑定房间`, target: { nav: "devices", id: d.id } })),
      };
    return { ...base, status: "done", summary: `共 ${active.length} 台，都已绑定房间`, items: [] };
  })();

  // 3 安装与上线
  const s3 = ((): Step => {
    const base = {
      key: "install" as const,
      title: "安装与上线",
      why: "雷达通电联网后会每分钟上报心跳，心跳里带安装角度，角度不对会影响检测。",
      note: ANGLE_NOTE,
      action: { label: "去设备", target: { nav: "devices" as const } },
    };
    if (!active.length) return { ...base, status: "todo", summary: "先添加雷达", items: [] };
    if (!heavy) return unknown(base);
    const typeBySn = new Map<string, number>();
    for (const ds of heavy.designs.values())
      for (const e of radarElements(ds.design)) {
        const t = e.qingLanConfig?.installType;
        if (e.sn && (t === 0 || t === 1)) typeBySn.set(e.sn, t);
      }
    // 角度不对的排前面（人在现场能马上调），其次是在线但没心跳的，离线的最后
    const angleItems: StepItem[] = [];
    const silent: StepItem[] = [];
    const offline: StepItem[] = [];
    let online = 0;
    for (const d of active) {
      const hb = heavy.heartbeats.get(d.sn);
      const link = deviceLink({ lastReportAt: hb?.t, platformOnline: d.isOnline, now });
      const target: Target = { nav: "devices", id: d.id };
      if (!link.online) {
        offline.push({ text: `${nameOf(d)} · ${where(d)} · 离线${hb ? `（最近心跳 ${minsAgo(hb.t, now)}）` : "，还没收到过心跳"}`, target });
        continue;
      }
      online++;
      if (!hb) {
        silent.push({ text: `${nameOf(d)} · ${where(d)} · 还没收到心跳，看不到安装角度`, target });
        continue;
      }
      const type = typeBySn.get(d.sn);
      // 布置里没配安装方式：按更接近的那种标准判断
      const ev = type !== undefined ? evaluate(hb, type) : [evaluate(hb, 0), evaluate(hb, 1)].sort((x, y) => maxDev(x) - maxDev(y))[0]!;
      const off = ev.axes.filter((a) => Math.abs(a.dev) > ev.tol);
      if (!off.length) continue;
      const head = `${nameOf(d)} · ${where(d)} · `;
      if (type === undefined && maxDev(ev) > FAR_OFF)
        angleItems.push({ text: `${head}角度和顶装、侧装标准都对不上（x ${hb.x.toFixed(1)}° · y ${hb.y.toFixed(1)}° · z ${hb.z.toFixed(1)}°），看看是不是装反了`, target });
      else
        angleItems.push({
          text: `${head}${ev.name}角度超差：${off.map((a) => `${a.k} ${signed(a.dev)}`).join("、")}${type === undefined ? `（布置里没配安装方式，按更接近的${ev.name}判断）` : ""}`,
          target,
        });
    }
    const items = [...angleItems, ...silent, ...offline];
    const badAngle = angleItems.length;
    if (!items.length) return { ...base, status: "done", summary: `${active.length} 台都在线，安装角度都在 ±2° 以内`, items };
    const parts = [`${online} / ${active.length} 台在线`, badAngle ? `${badAngle} 台角度超差` : ""].filter(Boolean);
    return { ...base, status: "doing", summary: parts.join(" · "), items };
  })();

  // 布置、场景、体检共用的诊断结果
  const layoutReports = heavy ? roomReports(data, false) : [];
  const fullReports = heavy ? roomReports(data, true) : [];
  const configBySn = new Map(layoutReports.flatMap((r) => r.radars.filter((x) => x.config).map((x) => [x.sn, x.config!] as const)));

  // 4 布置房间
  const s4 = ((): Step => {
    const base = {
      key: "layout" as const,
      title: "布置房间",
      why: "在房间里放好雷达、画出床和门等区域并下发到设备，雷达才知道人在哪、哪里是床。",
      note: "设备详情 › 属性 › 安装区域里画区域；同样的房间画好一间后，用“复制布置到其他房间”批量完成",
      action: { label: "去设备", target: { nav: "devices" as const } },
    };
    if (!bound.length) return { ...base, status: "todo", summary: "先添加雷达并绑定房间", items: [] };
    if (!heavy) return unknown(base);
    const items: StepItem[] = [];
    let zoned = 0;
    for (const rep of layoutReports)
      for (const r of rep.radars) {
        // 只看绑在这间房、在用的雷达；布置里残留的旧雷达放到体检里
        if (!r.device || r.device.isDisabled || r.device.roomId !== rep.room.id || r.level === "none") continue;
        zoned++;
        if (r.level !== "error" && r.level !== "warn") continue;
        const [first, ...rest] = r.issues;
        items.push({ text: `${nameOf(r.device)} · ${rep.room.roomName}：${first?.text ?? "布置有问题"}${rest.length ? `（还有 ${rest.length} 项）` : ""}`, target: { nav: "devices", id: r.device.id } });
      }
    const tips: StepItem[] = [];
    for (const room of rooms) {
      const bs = bedsOf.get(room.id) ?? [];
      if (bs.length && bound.some((d) => d.roomId === room.id) && bs.every((b) => !b.deviceCount))
        tips.push({ text: `${room.roomName} 的床位还没绑雷达（楼宇页点开房间可以绑）`, tip: true, target: { nav: "spaces", id: room.id } });
    }
    if (items.length) return { ...base, status: "doing", summary: `${items.length} / ${zoned} 台雷达的布置还没弄好`, items: [...items, ...tips] };
    return { ...base, status: "done", summary: zoned ? `${zoned} 台雷达都已画进布置并下发` : "没有需要画区域的雷达型号", items: tips };
  })();

  // 5 下发场景
  const s5 = ((): Step => {
    const base = {
      key: "scenes" as const,
      title: "下发场景",
      why: "场景决定雷达在什么情况下报警（离床、跌倒、久卧等），不下发就不会有告警。",
      action: { label: "批量下发", target: { nav: "scenes" as const } },
    };
    if (!bound.length) return { ...base, status: "todo", summary: "先添加雷达并绑定房间", items: [] };
    if (!heavy) return unknown(base);
    const items: StepItem[] = [];
    let none = 0;
    for (const d of bound) {
      const sc = heavy.scenes.get(d.id) ?? [];
      if (!sc.some((s) => !s.isDisabled)) {
        none++;
        items.push({ text: `${nameOf(d)} · ${where(d)} · 还没有启用场景`, target: { nav: "scenes" } });
        continue;
      }
      const zonedType = d.deviceType === undefined || ZONE_TYPES.has(d.deviceType);
      for (const i of sceneIssues(sc, zonedType ? configBySn.get(d.sn) : undefined)) items.push({ text: `${nameOf(d)} · ${where(d)}：${i.text}`, target: { nav: "devices", id: d.id } });
    }
    if (!items.length) return { ...base, status: "done", summary: `${bound.length} 台雷达都已启用场景`, items };
    const wrong = items.length - none;
    return { ...base, status: "doing", summary: [none ? `${none} 台还没有启用场景` : "", wrong ? `${wrong} 处场景区域不对` : ""].filter(Boolean).join(" · "), items };
  })();

  // 6 录长者并入住
  const s6 = ((): Step => {
    const base = {
      key: "members" as const,
      title: "录长者并入住",
      why: "长者入住床位后，告警和体征才能对应到具体的人。",
      note: "长者多时用“批量导入”，按模板填好 Excel 一次导入并入住",
      action: { label: "去长者", target: { nav: "members" as const } },
    };
    if (!beds.length) return { ...base, status: "todo", summary: "先建好床位", items: [] };
    const occupied = beds.filter((b) => b.bedStatus === 2 || b.realName).length;
    if (!occupied) return { ...base, status: "todo", summary: `${beds.length} 张床，还没有长者入住`, items: [] };
    return { ...base, status: "done", summary: `${occupied} / ${beds.length} 张床已入住`, items: [] };
  })();

  // 7 体检
  const s7 = ((): Step => {
    const base = {
      key: "diagnose" as const,
      title: "体检",
      why: "最后跑一遍诊断，查出布置残留、场景区域不对、下发失败这类前面不容易看到的问题。",
      action: { label: "去诊断", target: { nav: "rooms" as const } },
    };
    if (!rooms.length || !bound.length) return { ...base, status: "todo", summary: "前面几步做完后再检查", items: [] };
    if (!heavy) return unknown(base);
    const bad = fullReports.filter((r) => r.level === "error" || r.level === "warn");
    if (!bad.length) return { ...base, status: "done", summary: `${rooms.length} 间房都没有问题`, items: [] };
    return {
      ...base,
      status: "doing",
      summary: `${bad.length} 间房有问题`,
      items: bad.map((r) => {
        const n = r.issues.length + r.radars.reduce((k, x) => k + x.issues.length, 0);
        return { text: `${r.room.roomName}${r.room.buildingName ? ` · ${r.room.buildingName}` : ""} · ${n} 个问题`, target: { nav: "rooms", id: r.room.id } };
      }),
    };
  })();

  return [s1, s2, s3, s4, s5, s6, s7];
}
