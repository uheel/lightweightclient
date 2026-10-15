import type { Radar } from "../api/device";
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
export const INSTALL_NEED: Record<string, number> = { 进入卧室: 1, 进入客厅: 2, 进入卫生间: 3 };

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
