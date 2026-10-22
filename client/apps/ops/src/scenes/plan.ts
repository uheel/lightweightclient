import type { Radar } from "../api/device";
import { BATHROOM, BEDROOM } from "../rooms/installArea";
import { INSTALL_AREA, type LayoutRange, type RadarLayout, type Scene, type SceneTemplate } from "../api/scene";

/**
 * 批量场景：每台设备要怎么改。
 * 平台保存是整体覆盖，所以启用 = 把模板场景加进列表，禁用 = 从列表里去掉，其他场景原样带回。
 */

export type Choice = "keep" | "enable" | "disable";

interface AreaNeed {
  label: string;
  match: (r: LayoutRange) => boolean;
}

const BED: AreaNeed = { label: "监护床", match: (r) => r.type === 5 };
const space = (code: number, label: string): AreaNeed => ({ label, match: (r) => r.spaceType === code });

/** 涉及区域的场景要对应哪种区域（监护床只能有一个；其他按"空间区域类型"找） */
export const AREA_NEED: Record<string, AreaNeed> = {
  离床告警: BED,
  入床提醒: BED,
  过度睡眠: BED,
  延迟离床报警: BED,
  离床延迟报警: BED,
  呼吸暂停: BED,
  马桶久坐: space(56, "马桶区域"),
  淋浴过久: space(57, "淋浴区域"),
  久坐提醒: space(52, "沙发区域"),
};

/** 只适合某类房间的场景：雷达安装区域要对得上 */
export const INSTALL_NEED: Record<string, number> = { 进入卧室: BEDROOM, 进入客厅: 2, 进入卫生间: BATHROOM };

const AREA_PROPS = new Set(["QL_event_area_ID", "QL_event_area"]);
/** 表达式里的区域条件，例如 COUNT_2D(QL_event_area_ID_data,"==",1,">=",1,0,5) */
const AREA_EXPR = /(QL_event_area(?:_ID)?_data\s*,\s*"==\s*"\s*,\s*)(\{\{area\}\}|-?\d+)/g;
const EXPR_KEYS = ["normalExpression", "interExpression", "exitExpression"] as const;

/** COUNT 时取值比较在 countTarget，REAL 时在 target */
const areaField = (c: { aggregation?: string }) => (c.aggregation === "COUNT" ? "countTarget" : "target");

/** 模板里写的区域值（{{area}} 或写死的编号） */
export function templateAreaValues(s: Scene) {
  const out = new Set<string>();
  for (const c of s.conditions ?? []) {
    if (c.property && AREA_PROPS.has(c.property)) out.add(String(c[areaField(c)] ?? ""));
  }
  for (const k of EXPR_KEYS) {
    const e = s[k];
    if (typeof e === "string") for (const m of e.matchAll(AREA_EXPR)) out.add(m[2]!);
  }
  if (JSON.stringify(s).includes("{{area}}")) out.add("{{area}}");
  return [...out];
}

const stripId = <T extends { id?: string }>({ id: _id, ...rest }: T) => rest;

/** 模板场景转成新场景：场景、条件、动作都去掉 id，由平台重新分配 */
function fromTemplate(t: Scene): Scene {
  return {
    ...stripId(t),
    sceneName: t.sceneName,
    isDisabled: false,
    conditions: t.conditions?.map(stripId),
    actions: t.actions?.map(stripId),
  };
}

/** 把区域条件改成指定区域编号 */
function fillArea(s: Scene, index: number): Scene {
  const v = String(index);
  const out: Scene = {
    ...s,
    conditions: s.conditions?.map((c) => {
      const n = { ...c };
      for (const [k, val] of Object.entries(n)) if (val === "{{area}}") n[k] = v;
      if (c.property && AREA_PROPS.has(c.property)) n[areaField(c)] = v;
      return n;
    }),
  };
  for (const k of EXPR_KEYS) {
    const e = s[k];
    if (typeof e === "string") out[k] = e.replace(AREA_EXPR, `$1${v}`).split("{{area}}").join(v);
  }
  return out;
}

export type OpKind = "add" | "replace" | "remove" | "same" | "absent" | "skip";

export interface SceneOp {
  name: string;
  kind: OpKind;
  note?: string;
}

export interface DevicePlan {
  device: Radar;
  ops: SceneOp[];
  /** 要下发的完整场景列表；没有变化或不能下发时为空 */
  scenes?: Scene[];
  /** 会被清掉的已停用场景数（平台保存时也会清掉） */
  dropped: number;
  /** 整台设备不下发的原因 */
  blocked?: string;
  /** 读取设备场景或房间失败 */
  error?: string;
}

/** 每个（型号, 场景名）用哪个模板：同名取最近更新的 */
export function pickTemplates(templates: SceneTemplate[]) {
  const m = new Map<string, SceneTemplate>();
  for (const t of templates) {
    const k = `${t.deviceType}|${t.templateName}`;
    const cur = m.get(k);
    if (!cur || (t.updatedAt ?? "") > (cur.updatedAt ?? "")) m.set(k, t);
  }
  return m;
}

export const tplKey = (deviceType: number | undefined, name: string) => `${deviceType}|${name}`;

export function planDevice(opts: {
  device: Radar;
  current: Scene[];
  layout?: RadarLayout;
  choices: [string, Choice][];
  /** 型号 + 场景名 → 模板场景定义 */
  templateScene: (deviceType: number | undefined, name: string) => Scene | undefined;
  overwrite: boolean;
}): DevicePlan {
  const { device, current, layout, choices, templateScene, overwrite } = opts;
  const list = current.filter((s) => !s.isDisabled);
  const dropped = current.length - list.length;
  const ops: SceneOp[] = [];

  for (const [name, choice] of choices) {
    if (choice === "keep") continue;
    const at = list.findIndex((s) => s.sceneName === name);

    if (choice === "disable") {
      if (at < 0) ops.push({ name, kind: "absent", note: "本来没有" });
      else {
        list.splice(at, 1);
        ops.push({ name, kind: "remove" });
      }
      continue;
    }

    const tpl = templateScene(device.deviceType, name);
    if (!tpl) {
      ops.push({ name, kind: "skip", note: "这个型号没有该场景模板" });
      continue;
    }
    if (at >= 0 && !overwrite) {
      ops.push({ name, kind: "same", note: "已启用，保持原设置" });
      continue;
    }
    const inst = INSTALL_NEED[name];
    if (inst !== undefined && layout?.installArea !== inst) {
      const cur = layout?.installArea !== undefined ? INSTALL_AREA[layout.installArea] ?? `区域 ${layout.installArea}` : "未设置";
      ops.push({ name, kind: "skip", note: `雷达安装区域是"${cur}"，不是"${INSTALL_AREA[inst]}"` });
      continue;
    }

    let scene = fromTemplate(tpl);
    let note: string | undefined;
    const before = templateAreaValues(tpl);
    if (before.length) {
      const need = AREA_NEED[name];
      if (!need) {
        ops.push({ name, kind: "skip", note: "模板涉及区域，但不知道该对应哪种区域" });
        continue;
      }
      if (!layout) {
        ops.push({ name, kind: "skip", note: device.roomId ? "房间布局里没有这台雷达" : "设备未绑定房间" });
        continue;
      }
      const r = layout.ranges.find(need.match);
      if (!r) {
        ops.push({ name, kind: "skip", note: `户型里没有${need.label}` });
        continue;
      }
      scene = fillArea(scene, r.index);
      // 模板里写死的编号和户型不一致时提示一下（{{area}} 占位符不算）
      const fixed = before.filter((v) => v !== "{{area}}" && v !== String(r.index));
      note = `${need.label} = 区域 ${r.index}${fixed.length ? `（模板里写的是 ${fixed.join(" / ")}）` : ""}`;
    }

    if (at >= 0) {
      list[at] = { ...scene, id: list[at]!.id };
      ops.push({ name, kind: "replace", note });
    } else {
      list.push(scene);
      ops.push({ name, kind: "add", note });
    }
  }

  const changed = ops.some((o) => o.kind === "add" || o.kind === "replace" || o.kind === "remove");
  const blocked = changed && !device.isOnline ? "设备离线" : changed && device.isDisabled ? "设备已停用" : undefined;
  return {
    device,
    ops,
    dropped,
    blocked,
    scenes: changed && !blocked ? list.map((s) => ({ ...s, isDisabled: false })) : undefined,
  };
}

/** 区域条件属性 → 同型号的人员事件属性（退出表达式里看"离开区域"用）：6 型 QL_event_type，13 型 QL_target_event */
const EVENT_PROP: Record<string, string> = { QL_event_area_ID: "QL_event_type", QL_event_area: "QL_target_event" };

/** COUNT 条件的表达式写法：COUNT_2D(属性_data, 取值比较, 取值, 条数比较, 条数, 0, 最近几条)，和平台模板（延迟离床报警）一致 */
const count2d = (prop: string, countOp: string, countTarget: unknown, op: string, target: unknown, range: unknown) =>
  `COUNT_2D(${prop}_data,"${countOp}",${countTarget},"${op}",${target},0,${range})`;

/**
 * "在区域里待够 N 分钟才提醒"（久坐）：把模板改成超时类型。
 * 进入表达式 = 模板的 COUNT 条件逐条换成 COUNT_2D（区域 + 坐姿），退出表达式 = 离开该区域（人员事件 4 + 区域 ID），timeout = N 分钟。
 * 2026-10-21 距离测试 …6711（6 型）真人实测：坐下后 123 秒（timeout 120）触发一次，一直坐着不重复。
 * 条件 sys_duration、场景 duration 在 6 型上都不能这样用（前者一直不触发，后者整条下发设备不应答）。
 */
function toTimeout(s: Scene, minutes: number): Scene {
  const conds = s.conditions ?? [];
  if (!conds.length || conds.some((c) => c.aggregation !== "COUNT" || !c.property)) throw new Error("模板条件不是按记录统计的，不能设时长");
  const area = conds.find((c) => AREA_PROPS.has(c.property!));
  if (!area) throw new Error("模板里没有区域条件，不能设时长");
  const inter = conds.map((c) => count2d(c.property!, c.countOperator ?? "==", c.countTarget, c.operator ?? ">=", c.target, c.range ?? 1)).join(" and ");
  const exit = `${count2d(EVENT_PROP[area.property!]!, "==", 4, ">=", 1, 3)} and ${count2d(area.property!, "==", area.countTarget, ">=", 1, 3)}`;
  const { conditions: _c, relation: _r, duration: _d, ...rest } = s;
  return { ...rest, conditionType: "timeout", timeout: minutes * 60, interExpression: inter, exitExpression: exit };
}

/** 13 型每秒一条人员记录 */
const RECORDS_PER_MINUTE = 60;
/** 13 型每个目标最多存的记录条数（用户告知，2026-10-22）；实测 400 条可以，超过 600 的窗口永远凑不满 */
const MAX_RECORDS = 600;

/** "待够 N 分钟"最多能设多少分钟：13 型受记录条数限制，其他型号用超时类型，按平台的 1～999 */
export const maxMinutes = (deviceType?: number) => (deviceType === 13 ? MAX_RECORDS / RECORDS_PER_MINUTE : 999);

/**
 * 13 型的"待够 N 分钟"：13 型固件不收超时 / 表达式场景（set-tact 回 code 100，平台自带的 13 型离床延迟报警模板也一样），只能用条件列表。
 * 区域条件改成"最近 N × 60 条全是该区域"，坐姿等其他条件照模板；触发间隔设成 N 分钟，一直坐着时每 N 分钟提醒一次。
 * 2026-10-22 ultra跌倒雷达 …C50D 真人实测：最近 120 / 300 / 400 条分别在进入区域后 119 / 296 / 396 秒触发；更长的还没测，每人存多少条不知道。
 */
function toLongWindow(s: Scene, minutes: number): Scene {
  const n = minutes * RECORDS_PER_MINUTE;
  if (n > MAX_RECORDS) throw new Error(`13 型最多 ${MAX_RECORDS / RECORDS_PER_MINUTE} 分钟（每人最多存 ${MAX_RECORDS} 条记录，每秒一条）`);
  const conds = s.conditions ?? [];
  const area = conds.find((c) => c.property && AREA_PROPS.has(c.property) && c.aggregation === "COUNT");
  if (!area) throw new Error("模板里没有按记录统计的区域条件，不能设时长");
  return {
    ...s,
    maskTime: minutes,
    conditions: conds.map((c) => (c === area ? { ...c, range: String(n), operator: "==", target: String(n) } : c)),
  };
}

/** 设时长的写法：13 型只能用加长区域条件，其他型号用超时类型 */
const withMinutes = (s: Scene, minutes: number, deviceType?: number) => (deviceType === 13 ? toLongWindow(s, minutes) : toTimeout(s, minutes));

/** 场景要待够几分钟才触发：超时类型看 timeout，13 型看区域条件的记录数（至少 1 分钟才算）；都不是时没有 */
export function durationOf(s: Scene) {
  if (s.conditionType === "timeout") return s.timeout ? Math.round(s.timeout / 60) : undefined;
  const area = s.conditions?.find((c) => c.property && AREA_PROPS.has(c.property) && c.aggregation === "COUNT");
  const n = Number(area?.range);
  return area && area.operator === "==" && Number(area.target) === n && n >= RECORDS_PER_MINUTE ? Math.round(n / RECORDS_PER_MINUTE) : undefined;
}

/**
 * 单台设备开 / 关一个场景，返回要下发的完整列表（已停用的场景平台保存时也会清掉，这里同样不带）。
 * 开：用模板场景替换同名场景（没有就加上），涉及区域时填 area，给了 duration（分钟）时改成待够这么久才触发；关：去掉 names 里的所有同名场景。
 */
/** 场景动作：呼叫管理主机（雷达拨紧急号码 talk_master_number，不带参数）、播放本地音频 */
export const CALL_MASTER = "Service_call_master";
export const PLAY_AUDIO = "Service_play_audiofile";

export const callsMaster = (s?: Scene) => !!s?.actions?.some((a) => a.name === CALL_MASTER);
export const playsAudio = (s?: Scene) => !!s?.actions?.some((a) => a.name === PLAY_AUDIO);

/** 加上或去掉"呼叫管理主机"动作。平台规定和"播放本地音频"只能二选一 */
export function withCallMaster(s: Scene, on: boolean): Scene {
  const rest = (s.actions ?? []).filter((a) => a.name !== CALL_MASTER);
  if (on && playsAudio(s)) throw new Error("这个场景会播放音频，平台规定播放音频和呼叫管理主机只能二选一");
  return { ...s, actions: on ? [...rest, { type: "method", name: CALL_MASTER }] : rest };
}

export function toggleScene(
  current: Scene[],
  names: string[],
  tpl?: { name: string; scene: Scene; area?: number; duration?: number; deviceType?: number; callMaster?: boolean },
) {
  const list = current.filter((s) => !s.isDisabled && !names.includes(s.sceneName));
  if (tpl) {
    let scene = fromTemplate(tpl.scene);
    if (templateAreaValues(tpl.scene).length) {
      if (tpl.area === undefined) throw new Error("没有选区域");
      scene = fillArea(scene, tpl.area);
    }
    if (tpl.duration !== undefined) scene = withMinutes(scene, tpl.duration, tpl.deviceType);
    if (tpl.callMaster !== undefined) scene = withCallMaster(scene, tpl.callMaster);
    const old = current.find((s) => !s.isDisabled && s.sceneName === tpl.name);
    list.push(old ? { ...scene, id: old.id } : scene);
  }
  return list.map((s) => ({ ...s, isDisabled: false }));
}

/** 并发执行，最多 n 个同时进行 */
export async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}
