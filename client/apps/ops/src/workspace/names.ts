import { useSyncExternalStore } from "react";
import { GROUPS, MODULES, type GroupKey, type ModuleKey } from "./modules";

/** 工作台类别、模块的自定义名字和模块所在类别（系统设置里改），存在本机，所有机构共用；没改的用默认 */
export interface CustomNames {
  groups?: Partial<Record<GroupKey, string>>;
  modules?: Partial<Record<ModuleKey, string>>;
  /** 换了类别的模块 → 新类别 */
  moves?: Partial<Record<ModuleKey, GroupKey>>;
  /** 类别在工作台上的顺序 */
  order?: GroupKey[];
}

/** 模块的默认类别；模块按这个顺序排，换到别的类别后也按它排在新类别里 */
const HOME = new Map<ModuleKey, GroupKey>(GROUPS.flatMap((g) => g.keys.map((k) => [k, g.key] as const)));
const ORDER = GROUPS.flatMap((g) => g.keys);

const KEY = "ops.customNames";
/** 名字最长几个字，太长方块和标签放不下 */
export const NAME_MAX = 12;

function load(): CustomNames {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as CustomNames;
  } catch {
    return {};
  }
}

let current = load();
const listeners = new Set<() => void>();

function save(next: CustomNames) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存不了也照样生效到关窗 */
  }
  listeners.forEach((f) => f());
}

/** 改一个名字；空白或和默认名一样就是恢复默认 */
export function setName(kind: "groups" | "modules", key: string, name: string) {
  // 存原样（不然输入时空格会被吃掉），显示时再去空白
  const v = name.trim();
  const def = kind === "groups" ? GROUPS.find((g) => g.key === key)?.title : MODULES[key as ModuleKey]?.label;
  const map: Record<string, string> = { ...current[kind] };
  if (!v || v === def) delete map[key];
  else map[key] = name;
  save({ ...current, [kind]: map });
}

/** 把模块换到另一个类别；换回默认类别就去掉记录 */
export function setGroup(k: ModuleKey, g: GroupKey) {
  const moves = { ...current.moves };
  if (HOME.get(k) === g) delete moves[k];
  else moves[k] = g;
  save({ ...current, moves });
}

/** 当前的类别顺序：存的顺序里去掉已经没有的类别，再补上新加的类别（排在最后） */
function groupOrder(n: CustomNames): GroupKey[] {
  const all = GROUPS.map((g) => g.key);
  const saved = (n.order ?? []).filter((k) => all.includes(k));
  return [...saved, ...all.filter((k) => !saved.includes(k))];
}

/** 类别往前（-1）或往后（1）挪一位；挪回默认顺序就去掉记录 */
export function moveGroup(g: GroupKey, by: -1 | 1) {
  const order = groupOrder(current);
  const i = order.indexOf(g);
  const j = i + by;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  const isDefault = order.every((k, x) => k === GROUPS[x].key);
  save({ ...current, order: isDefault ? undefined : order });
}

export function resetNames() {
  save({});
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/**
 * 取当前名字和布局：group(k) / module(k) 返回自定义名或默认名，groupOf(k) 是模块现在所在的类别，
 * layout 是工作台的类别（按自定义顺序）和各自的模块（没有模块的类别也在，工作台自己跳过）
 */
export function useNames() {
  const n = useSyncExternalStore(subscribe, () => current);
  const groupOf = (k: ModuleKey) => n.moves?.[k] ?? HOME.get(k)!;
  return {
    raw: n,
    groupOf,
    layout: groupOrder(n).map((g) => ({ key: g, keys: ORDER.filter((k) => groupOf(k) === g) })),
    group: (k: GroupKey) => n.groups?.[k]?.trim() || GROUPS.find((g) => g.key === k)!.title,
    module: (k: ModuleKey) => n.modules?.[k]?.trim() || MODULES[k].label,
  };
}
