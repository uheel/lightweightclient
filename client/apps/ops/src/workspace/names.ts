import { useSyncExternalStore } from "react";
import { GROUPS, MODULES, type GroupKey, type ModuleKey } from "./modules";

/** 类别：内置的（GroupKey）或系统设置里新增的（"c" 开头） */
export type GroupId = GroupKey | `c${string}`;
/** 菜单设置里新增的链接模块（"l" 开头）：点开在标签里显示第三方网址 */
export type LinkKey = `l${string}`;
/** 工作台上的一个方块：内置模块或链接模块 */
export type ItemKey = ModuleKey | LinkKey;

export interface LinkDef {
  key: LinkKey;
  /** 名字存原样 */
  title: string;
  url: string;
  group: GroupId;
}

/** 模块的图标：内置图标库里的一个（按名字），或上传的图片（缩成小图的 data URL） */
export type IconChoice = { builtin: string } | { image: string };

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
  hiddenModules?: ItemKey[];
  /** 默认隐藏的模块里，系统设置中打开显示的 */
  shownModules?: ModuleKey[];
  /** 换了图标的模块（内置和链接模块都行） */
  icons?: Partial<Record<ItemKey, IconChoice>>;
  /** 新增的链接模块，按新增先后 */
  links?: LinkDef[];
}

/** 默认不在工作台上显示的模块（系统设置：从右上角用户菜单进） */
const DEFAULT_HIDDEN: ModuleKey[] = ["settings"];
const defaultHidden = (k: string): k is ModuleKey => (DEFAULT_HIDDEN as string[]).includes(k);

/** 模块的默认类别；模块按这个顺序排，换到别的类别后也按它排在新类别里 */
const HOME = new Map<ModuleKey, GroupKey>(GROUPS.flatMap((g) => g.keys.map((k) => [k, g.key] as const)));
const ORDER = GROUPS.flatMap((g) => g.keys);

const KEY = "ops.customNames";
/** 名字最长几个字，太长方块和标签放不下 */
export const NAME_MAX = 12;
/** 新增类别没起名字时显示的名字 */
const UNTITLED = "未命名类别";
const UNTITLED_LINK = "未命名链接";
/** 链接模块所在的类别被删了就放到这里 */
const LINK_FALLBACK: GroupKey = "system";

export const isLink = (k: string): k is LinkKey => /^l[0-9a-z]+$/.test(k);

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
export function setGroup(k: ItemKey, g: GroupId) {
  if (isLink(k)) return updateLink(k, { group: g });
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

/** 新增一个链接模块，放在指定类别的最后；返回它的 key */
export function addLink(group: GroupId) {
  const key = `l${Date.now().toString(36)}` as const;
  save({ ...current, links: [...(current.links ?? []), { key, title: "", url: "", group }] });
  return key;
}

export function updateLink(key: LinkKey, patch: Partial<Omit<LinkDef, "key">>) {
  save({ ...current, links: current.links?.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
}

/** 删掉链接模块，连同它的图标和隐藏记录 */
export function removeLink(key: LinkKey) {
  const links = current.links?.filter((l) => l.key !== key);
  const icons = { ...current.icons };
  delete icons[key];
  const hiddenModules = current.hiddenModules?.filter((k) => k !== key);
  save({ ...current, links: links?.length ? links : undefined, icons, hiddenModules: hiddenModules?.length ? hiddenModules : undefined });
}

/** 换图标；undefined = 恢复默认 */
export function setIcon(k: ItemKey, icon: IconChoice | undefined) {
  const icons = { ...current.icons };
  if (icon) icons[k] = icon;
  else delete icons[k];
  save({ ...current, icons });
}

/** 删掉新增的类别：换到这个类别里的模块回到各自原来的类别（链接模块放到系统管理） */
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

/** 隐藏 / 取消隐藏一个类别或模块（系统设置也能隐藏，右上角用户菜单里总能进） */
export function toggleHidden(kind: "hiddenGroups" | "hiddenModules", key: string) {
  // 默认隐藏的模块反过来记"打开显示"
  if (kind === "hiddenModules" && defaultHidden(key)) {
    const shown = current.shownModules ?? [];
    const next = shown.includes(key) ? shown.filter((k) => k !== key) : [...shown, key];
    return save({ ...current, shownModules: next.length ? next : undefined });
  }
  const list: string[] = current[kind] ?? [];
  const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  save({ ...current, [kind]: next.length ? next : undefined });
}

/** 名字、类别、隐藏和图标恢复默认；链接模块留着（只把它们的图标去掉，所在类别被删了的放到系统管理） */
export function resetNames() {
  save({ links: current.links });
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
  const link = (k: LinkKey) => n.links?.find((l) => l.key === k);
  const groupOfItem = (k: ItemKey): GroupId => {
    if (!isLink(k)) return groupOf(k);
    const g = link(k)?.group;
    return g && all.includes(g) ? g : LINK_FALLBACK;
  };
  // 每个类别里内置模块在前，链接模块按新增先后排在后面
  const layout = groupOrder(n).map((g) => ({
    key: g,
    keys: [...ORDER.filter((k) => groupOf(k) === g), ...(n.links ?? []).map((l) => l.key).filter((k) => groupOfItem(k) === g)] as ItemKey[],
  }));
  const groupHidden = (g: GroupId) => !!n.hiddenGroups?.includes(g);
  const moduleHidden = (k: ItemKey) => (defaultHidden(k) ? !n.shownModules?.includes(k) : !!n.hiddenModules?.includes(k));
  return {
    raw: n,
    groupOf: groupOfItem,
    link,
    icon: (k: ItemKey) => n.icons?.[k],
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
    module: (k: ItemKey) => (isLink(k) ? link(k)?.title.trim() || UNTITLED_LINK : n.modules?.[k]?.trim() || MODULES[k].label),
  };
}

/** 链接模块填的网址：没写 http(s):// 的补 https://；填得不像网址返回 undefined */
export function linkUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const full = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(full);
    return u.hostname.includes(".") || u.hostname === "localhost" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
