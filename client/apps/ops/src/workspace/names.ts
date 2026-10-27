import { useSyncExternalStore } from "react";
import { GROUPS, MODULES, type GroupKey, type ModuleKey } from "./modules";

/** 类别：内置的（GroupKey）或系统设置里新增的（"c" 开头） */
export type GroupId = GroupKey | `c${string}`;

/** 工作台类别、模块的自定义名字、模块所在类别和新增的类别（系统设置里改），存在本机，所有机构共用；没改的用默认 */
export interface CustomNames {
  groups?: Partial<Record<GroupKey, string>>;
  modules?: Partial<Record<ModuleKey, string>>;
  /** 换了类别的模块 → 新类别 */
  moves?: Partial<Record<ModuleKey, GroupId>>;
  /** 类别在工作台上的顺序 */
  order?: GroupId[];
  /** 新增的类别，按新增先后；名字存原样 */
  added?: { key: `c${string}`; title: string }[];
  /** 工作台上不显示的类别、模块 */
  hiddenGroups?: GroupId[];
  hiddenModules?: ModuleKey[];
}

/** 模块的默认类别；模块按这个顺序排，换到别的类别后也按它排在新类别里 */
const HOME = new Map<ModuleKey, GroupKey>(GROUPS.flatMap((g) => g.keys.map((k) => [k, g.key] as const)));
const ORDER = GROUPS.flatMap((g) => g.keys);

const KEY = "ops.customNames";
/** 名字最长几个字，太长方块和标签放不下 */
export const NAME_MAX = 12;
/** 新增类别没起名字时显示的名字 */
const UNTITLED = "未命名类别";

const isAdded = (k: string): k is `c${string}` => !GROUPS.some((g) => g.key === k);
/** 所有类别的默认顺序：内置的在前，新增的按新增先后排在后面 */
const allGroups = (n: CustomNames): GroupId[] => [...GROUPS.map((g) => g.key), ...(n.added ?? []).map((g) => g.key)];

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

/** 改一个名字；空白或和默认名一样就是恢复默认（新增的类别没有默认名，原样存） */
export function setName(kind: "groups" | "modules", key: string, name: string) {
  if (kind === "groups" && isAdded(key)) {
    return save({ ...current, added: current.added?.map((g) => (g.key === key ? { ...g, title: name } : g)) });
  }
  // 存原样（不然输入时空格会被吃掉），显示时再去空白
  const v = name.trim();
  const def = kind === "groups" ? GROUPS.find((g) => g.key === key)?.title : MODULES[key as ModuleKey]?.label;
  const map: Record<string, string> = { ...current[kind] };
  if (!v || v === def) delete map[key];
  else map[key] = name;
  save({ ...current, [kind]: map });
}

/** 把模块换到另一个类别；换回默认类别就去掉记录 */
export function setGroup(k: ModuleKey, g: GroupId) {
  const moves = { ...current.moves };
  if (HOME.get(k) === g) delete moves[k];
  else moves[k] = g;
  save({ ...current, moves });
}

/** 新增一个空类别，排在最后；返回它的 key */
export function addGroup(title = "") {
  const key = `c${Date.now().toString(36)}` as const;
  save({ ...current, added: [...(current.added ?? []), { key, title }] });
  return key;
}

/** 删掉新增的类别：换到这个类别里的模块回到各自原来的类别 */
export function removeGroup(key: GroupId) {
  if (!isAdded(key)) return;
  const moves = Object.fromEntries(Object.entries(current.moves ?? {}).filter(([, g]) => g !== key));
  const hiddenGroups = current.hiddenGroups?.filter((g) => g !== key);
  const added = current.added?.filter((g) => g.key !== key);
  const order = current.order?.filter((g) => g !== key);
  // 删完和默认顺序一样就不再记顺序
  const def = allGroups({ added });
  save({ ...current, moves, added, hiddenGroups: hiddenGroups?.length ? hiddenGroups : undefined, order: order?.every((k, x) => k === def[x]) ? undefined : order });
}

/** 当前的类别顺序：存的顺序里去掉已经没有的类别，再补上新加的类别（排在最后） */
function groupOrder(n: CustomNames): GroupId[] {
  const all = allGroups(n);
  const saved = (n.order ?? []).filter((k) => all.includes(k));
  return [...saved, ...all.filter((k) => !saved.includes(k))];
}

/** 类别往前（-1）或往后（1）挪一位；挪回默认顺序就去掉记录 */
export function moveGroup(g: GroupId, by: -1 | 1) {
  const order = groupOrder(current);
  const i = order.indexOf(g);
  const j = i + by;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  const def = allGroups(current);
  const isDefault = order.every((k, x) => k === def[x]);
  save({ ...current, order: isDefault ? undefined : order });
}

/** 系统设置不能隐藏（藏了就没处改回来），所在的类别也不能隐藏 */
export const UNHIDEABLE: ModuleKey = "settings";

/** 隐藏 / 取消隐藏一个类别或模块 */
export function toggleHidden(kind: "hiddenGroups" | "hiddenModules", key: string) {
  if (key === UNHIDEABLE) return;
  const list: string[] = current[kind] ?? [];
  const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  save({ ...current, [kind]: next.length ? next : undefined });
}

export function resetNames() {
  save({});
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/**
 * 取当前名字和布局：group(k) / module(k) 返回自定义名或默认名，isAdded(k) 是不是新增的类别，groupOf(k) 是模块现在所在的类别，
 * layout 是所有类别（按自定义顺序）和各自的模块，包括空的和隐藏的；desk 是工作台上实际显示的（去掉隐藏的，再去掉空类别）
 */
export function useNames() {
  const n = useSyncExternalStore(subscribe, () => current);
  const all = allGroups(n);
  // 换去的类别被删了就回原来的类别
  const groupOf = (k: ModuleKey): GroupId => {
    const g = n.moves?.[k];
    return g && all.includes(g) ? g : HOME.get(k)!;
  };
  const layout = groupOrder(n).map((g) => ({ key: g, keys: ORDER.filter((k) => groupOf(k) === g) }));
  const groupHidden = (g: GroupId) => !!n.hiddenGroups?.includes(g);
  const moduleHidden = (k: ModuleKey) => !!n.hiddenModules?.includes(k);
  return {
    raw: n,
    groupOf,
    layout,
    desk: layout
      .filter((g) => !groupHidden(g.key))
      .map((g) => ({ ...g, keys: g.keys.filter((k) => !moduleHidden(k)) }))
      .filter((g) => g.keys.length),
    groupHidden,
    moduleHidden,
    group: (k: GroupId) =>
      isAdded(k) ? n.added?.find((g) => g.key === k)?.title.trim() || UNTITLED : n.groups?.[k]?.trim() || GROUPS.find((g) => g.key === k)!.title,
    isAdded,
    module: (k: ModuleKey) => n.modules?.[k]?.trim() || MODULES[k].label,
  };
}
