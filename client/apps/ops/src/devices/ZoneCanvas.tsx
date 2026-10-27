import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, Select } from "antd";
import { DeleteOutlined, PlusOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import type { PlanElement, RoomDesign } from "../api/room";
import RoomBackdrop from "../rooms/RoomBackdrop";

/**
 * 区域画布：在平面图方向上拖动区域、拖边角改大小，监测范围也直接拖边。界面上不出现坐标数字。
 * 内部全部用设备坐标（分米，以雷达为原点）：设备只认这个，也正好是设备的精度（10 cm）。
 * 画的时候按房间平面图的方向转一下（和平台网页端、运维端"诊断"页一致）。
 */

/** 区域画布上的房间：外框（cm）、雷达在房间里的位置，以及用来画家具的布置元素 */
export interface CanvasRoom {
  width: number;
  height: number;
  radar: { x: number; y: number };
  roomStyle?: RoomDesign["roomStyle"];
  elements?: PlanElement[];
}

/** 设备坐标里的矩形，分米 */
export interface DmRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface CanvasZone extends DmRect {
  id: number;
  type: number;
  /** 区域名字（只存在房间布置里，设备不认）；自定义区靠它区分沙发区、马桶区… */
  text?: string;
  /** 空间区域类型（字典 ROOM_SPACE_TYPE），场景按它找马桶区、淋浴区 */
  spaceType?: number;
}

/** 自定义区（感应区）：名字自己起，空间区域类型决定场景认它是哪种区域 */
export const CUSTOM = 6;

export interface ZoneType {
  value: number;
  label: string;
  color: string;
  /** 新加时的大小（平面图上 宽 × 高，分米） */
  size: [number, number];
}

/** 设备坐标 → 平面图方向（y 向下），是平台 toRoom 的偏移部分 */
export function toPlan(installType: number, facing: number, x: number, y: number): [number, number] {
  if (installType === 1) return facing === 2 ? [-y, -x] : facing === 3 ? [x, -y] : facing === 4 ? [y, x] : [-x, y];
  return facing === 2 ? [y, x] : facing === 3 ? [-x, y] : facing === 4 ? [-y, -x] : [x, -y];
}

/** toPlan 的逆运算 */
export function fromPlan(installType: number, facing: number, X: number, Y: number): [number, number] {
  if (installType === 1) return facing === 2 ? [-Y, -X] : facing === 3 ? [X, -Y] : facing === 4 ? [Y, X] : [-X, Y];
  return facing === 2 ? [Y, X] : facing === 3 ? [-X, Y] : facing === 4 ? [-Y, -X] : [X, -Y];
}

/** 探测范围的上限（设备坐标）：容器尺寸按装法和模式查表，换到设备坐标后和朝向无关 */
export function limitOf(installType: number, mode: number): DmRect {
  if (installType !== 1) return { x0: -30, x1: 30, y0: -20, y1: 20 };
  if (mode === 3) return { x0: -40, x1: 40, y0: 0, y1: 60 };
  if (mode === 11) return { x0: -6, x1: 6, y0: 0, y1: 20 };
  return { x0: -30, x1: 30, y0: 0, y1: 40 };
}

/**
 * 监测范围要把雷达围在里面：雷达往两边（顶装是四周）探测，每条边都在雷达的那一侧、离雷达至少 1 分米（10 cm），
 * 不能整个跑到雷达一边去（右边界变成负值）。侧装的近边就是雷达所在的墙（y0 = 0），不用管
 */
export function aroundRadar(installType: number, b: DmRect): DmRect {
  return { x0: Math.min(b.x0, -1), x1: Math.max(b.x1, 1), y0: installType === 1 ? b.y0 : Math.min(b.y0, -1), y1: Math.max(b.y1, 1) };
}

/** 监测范围有没有把雷达围在里面（见 aroundRadar） */
export const surroundsRadar = (installType: number, b: DmRect) => JSON.stringify(aroundRadar(installType, b)) === JSON.stringify(b);

type EdgeX = "x0" | "x1";
type EdgeY = "y0" | "y1";
/** 拖的是哪条边 / 哪个角（用设备坐标的边表示） */
interface Grip {
  x?: EdgeX;
  y?: EdgeY;
}

type Target = { kind: "zone"; index: number } | { kind: "bound" } | { kind: "radar" };

interface Drag {
  target: Target;
  grip?: Grip;
  /** 按下时指针在平面图上的位置 */
  start: [number, number];
  /** 按下时的矩形 */
  rect: DmRect;
}

/** 平移：按下时的指针位置、视图（中心按房间坐标，分米）和每个屏幕像素是多少分米 */
interface Pan {
  x: number;
  y: number;
  c: [number, number];
  w: number;
  h: number;
  u: number;
  moved: boolean;
  /** 在空白处点一下（没拖）时取消选中；空格 / 中键平移不取消 */
  deselect: boolean;
}

/** 缩放比例范围（相对"适应"） */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 20;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmtM = (dm: number) => (dm / 10).toFixed(1).replace(/\.0$/, "");

/** 矩形移动 dx/dy 后限制在 lim 里，大小不变 */
function moveInside(r: DmRect, dx: number, dy: number, lim: DmRect): DmRect {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const x0 = clamp(r.x0 + dx, lim.x0, lim.x1 - w);
  const y0 = clamp(r.y0 + dy, lim.y0, lim.y1 - h);
  return { x0, x1: x0 + w, y0, y1: y0 + h };
}

/** 拖边 / 角：把对应的边移到 (x, y)，至少 1 分米宽，限制在 lim 里 */
function resizeInside(r: DmRect, g: Grip, x: number, y: number, lim: DmRect): DmRect {
  const n = { ...r };
  if (g.x === "x0") n.x0 = clamp(x, lim.x0, r.x1 - 1);
  if (g.x === "x1") n.x1 = clamp(x, r.x0 + 1, lim.x1);
  if (g.y === "y0") n.y0 = clamp(y, lim.y0, r.y1 - 1);
  if (g.y === "y1") n.y1 = clamp(y, r.y0 + 1, lim.y1);
  return n;
}

/** 两个矩形有重叠面积（只碰边不算） */
const overlaps = (a: DmRect, b: DmRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

const intersect = (a: DmRect, b: DmRect): DmRect | undefined => {
  const r = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : undefined;
};

/**
 * 从 cur 往 target 一格（10 cm）一格地挪，碰到别的区域就停在贴边的位置：先挪 x 再挪 y，再补一次 x，
 * 这样斜着拖碰到一条边时还能沿着边滑过去。blocked 判断某个位置能不能放
 */
function slideTo(cur: DmRect, target: DmRect, blocked: (r: DmRect) => boolean): DmRect {
  let r = cur;
  const axis = (k: "x" | "y") => {
    const a = k === "x" ? "x0" : "y0";
    const b = k === "x" ? "x1" : "y1";
    const d = target[a] - r[a];
    const step = Math.sign(d);
    for (let i = 0; i < Math.abs(d); i++) {
      const n = { ...r, [a]: r[a] + step, [b]: r[b] + step };
      if (blocked(n)) break;
      r = n;
    }
  };
  axis("x");
  axis("y");
  axis("x");
  return r;
}

/** 拖边 / 角时同理：被拖的边一格一格挪向目标，碰到别的区域就停 */
function resizeTo(cur: DmRect, target: DmRect, g: Grip, blocked: (r: DmRect) => boolean): DmRect {
  let r = cur;
  for (const e of [g.x, g.y]) {
    if (!e) continue;
    const d = target[e] - r[e];
    const step = Math.sign(d);
    for (let i = 0; i < Math.abs(d); i++) {
      const n = { ...r, [e]: r[e] + step };
      if (blocked(n)) break;
      r = n;
    }
  }
  return r;
}

/**
 * 床位监护模式下监护床只能画在这个范围里（设备坐标，分米）：
 * 侧装是雷达正前方 2 × 2 米（贴着雷达所在的墙），顶装是以雷达为中心 3 × 3 米。和平台的"监护区"大小一致（qinglan.ts 的 supervisionSize）
 */
export function bedRangeOf(installType: number, mode: number): DmRect | undefined {
  if (mode !== 15) return undefined;
  return installType === 1 ? { x0: -10, x1: 10, y0: 0, y1: 20 } : { x0: -15, x1: 15, y0: -15, y1: 15 };
}

const GRIPS: Grip[] = [{ x: "x0" }, { x: "x1" }, { y: "y0" }, { y: "y1" }, { x: "x0", y: "y0" }, { x: "x1", y: "y0" }, { x: "x0", y: "y1" }, { x: "x1", y: "y1" }];

export default function ZoneCanvas({
  installType,
  facing,
  bound,
  limit,
  mode,
  zones,
  room,
  types,
  disabled,
  onZones,
  onBound,
  onRadar,
  spaceTypes,
}: {
  installType: number;
  facing: number;
  /** 监测范围；没有安装配置时为空 */
  bound?: DmRect;
  /** 探测范围上限 */
  limit: DmRect;
  /** 工作模式：15 床位监护时画监护床的可画范围（虚线），监护床只能放在里面 */
  mode?: number;
  zones: CanvasZone[];
  /** 房间外框（cm，平面图坐标）和雷达在房间里的位置；不在房间布置里时没有 */
  room?: CanvasRoom;
  types: ZoneType[];
  disabled?: boolean;
  onZones: (z: CanvasZone[]) => void;
  onBound?: (b: DmRect) => void;
  /** 拖雷达到房间里的新位置（cm，平面图坐标）；侧装只能沿墙挪，限制由调用方做。不在房间布置里时不能拖 */
  onRadar?: (to: { x: number; y: number }) => void;
  /** 能给自定义区填名字和空间区域类型时给出选项（雷达在房间布置里才有地方存） */
  spaceTypes?: { value: number; label: string }[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // 网格 pattern 单独起 id，页面里有两张画布时不会串用对方的网格
  const gridId = `zc-grid-${useId().replace(/[^\w-]/g, "")}`;
  const [sel, setSel] = useState<Target>();
  /** 删除区域后编号前移的提示 */
  const [shifted, setShifted] = useState<string>();
  // 拖动状态放在 ref 里：快速拖动时 pointermove 可能比重新渲染先到，读 state 会丢掉这些移动
  const dragRef = useRef<Drag>(undefined);
  const [dragging, setDragging] = useState(false);
  /** 拖雷达时：按下时的视图范围和雷达位置（cm）。拖动中视图跟着雷达平移，房间在屏幕上不动 */
  const [radarView, setRadarView] = useState<{ view: [number, number, number, number]; radar0: { x: number; y: number } }>();
  const canMoveRadar = !!room && !!onRadar && !disabled;
  const stageRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<Pan>(undefined);
  const [panning, setPanning] = useState(false);
  /** 按住空格时拖哪里都是平移 */
  const [space, setSpace] = useState(false);
  /**
   * 缩放 / 平移后的视图：中心按房间坐标（分米，房间左上角为原点）存，拖雷达后房间在屏幕上不动；没有房间时就是平面图坐标。
   * 换装法、换墙、房间尺寸变了就回到"适应"
   */
  const [viewState, setViewState] = useState<{ key: string; cx: number; cy: number; w: number; h: number }>();
  const viewKey = `${installType}-${facing}-${room?.width}-${room?.height}`;
  const view = viewState?.key === viewKey ? viewState : undefined;
  const P = (x: number, y: number) => toPlan(installType, facing, x, y);
  const planRect = (r: DmRect) => {
    const [ax, ay] = P(r.x0, r.y0);
    const [bx, by] = P(r.x1, r.y1);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  };
  const typeOf = (t: number) => types.find((x) => x.value === t);
  const bedRange = bedRangeOf(installType, mode ?? 0);
  const zoneLimit = (z: { type: number }) => {
    const base = z.type === 3 ? limit : bound ?? limit;
    // 监护床再限制在可画范围里；和监测范围没有交集时（监测范围被拖得很小）就只按可画范围
    return z.type === 5 && bedRange ? (intersect(base, bedRange) ?? bedRange) : base;
  };
  /**
   * 区域之间不能重叠。拖动开始时已经和它重叠的区域（旧配置里画重了的）不算，方便把它们拖开；
   * 下面信息栏会提示哪些区域重叠
   */
  const blockerOf = (i: number, start: DmRect) => {
    const others = zones.filter((q, j) => j !== i && !overlaps(q, start));
    return (r: DmRect) => others.some((q) => overlaps(q, r));
  };
  const overlapPairs = zones.flatMap((a, i) => zones.slice(i + 1).flatMap((b) => (overlaps(a, b) ? [`${a.id} 和 ${b.id}`] : [])));

  // 视图范围：探测上限、房间、所有区域
  const roomRect = room && { x: -room.radar.x / 10, y: -room.radar.y / 10, w: room.width / 10, h: room.height / 10 };
  const all = [planRect(limit), ...(roomRect ? [roomRect] : []), ...zones.map(planRect)];
  const pad = 4;
  const fitX = Math.min(...all.map((r) => r.x)) - pad;
  const fitY = Math.min(...all.map((r) => r.y)) - pad;
  const fitW = Math.max(...all.map((r) => r.x + r.w)) + pad - fitX;
  const fitH = Math.max(...all.map((r) => r.y + r.h)) + pad - fitY;
  // 平面图坐标以雷达为原点，房间坐标 = 平面图坐标 + off
  const off: [number, number] = room ? [room.radar.x / 10, room.radar.y / 10] : [0, 0];
  const cur = view ?? { cx: fitX + fitW / 2 + off[0], cy: fitY + fitH / 2 + off[1], w: fitW, h: fitH };
  // 拖雷达时画面以雷达为原点，雷达挪了多少视图就反着平移多少，房间看起来不动；松手后再按新位置重新取景（缩放过的话保持缩放后的视图）
  const [vx, vy, vw, vh] =
    radarView && room
      ? [radarView.view[0] - (room.radar.x - radarView.radar0.x) / 10, radarView.view[1] - (room.radar.y - radarView.radar0.y) / 10, radarView.view[2], radarView.view[3]]
      : [cur.cx - off[0] - cur.w / 2, cur.cy - off[1] - cur.h / 2, cur.w, cur.h];
  const zoom = fitW / vw;
  // 文字、拖柄、雷达都按视图大小算，缩放后在屏幕上大小不变
  const fs = Math.max(vw, vh) / 42;

  /** 以平面图上的点 p（默认视图中心）为中心缩放 k 倍，p 在屏幕上不动 */
  function zoomBy(k: number, p?: [number, number]) {
    const z0 = fitW / cur.w;
    const z = clamp(z0 * k, ZOOM_MIN, ZOOM_MAX);
    k = z / z0;
    if (Math.abs(k - 1) < 1e-6) return;
    const px = p ? p[0] + off[0] : cur.cx;
    const py = p ? p[1] + off[1] : cur.cy;
    setViewState({ key: viewKey, cx: px + (cur.cx - px) / k, cy: py + (cur.cy - py) / k, w: cur.w / k, h: cur.h / k });
  }

  // 滚轮缩放：按住 Ctrl（触控板双指捏合也是）随时可以；点过画布（焦点在画布上）后直接滚轮。没点过时滚轮照常滚动页面。
  // React 的 onWheel 是 passive 的，不能 preventDefault，所以自己挂原生监听；处理函数每次渲染更新，读到最新的视图
  const wheelRef = useRef<(e: WheelEvent) => void>(undefined);
  wheelRef.current = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey && document.activeElement !== stageRef.current) return;
    e.preventDefault();
    const m = svgRef.current?.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    zoomBy(Math.exp(-dy * 0.0015), [p.x, p.y]);
  };
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const h = (e: WheelEvent) => wheelRef.current?.(e);
    stage.addEventListener("wheel", h, { passive: false });
    return () => stage.removeEventListener("wheel", h);
  }, []);

  /** 开始平移（拖空白处、监测范围框里，或空格 / 中键拖任何地方） */
  function beginPan(e: React.PointerEvent, deselect: boolean) {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return;
    e.preventDefault();
    svg.setPointerCapture?.(e.pointerId);
    panRef.current = { x: e.clientX, y: e.clientY, c: [cur.cx, cur.cy], w: cur.w, h: cur.h, u: 1 / m.a, moved: false, deselect };
  }

  /** 指针位置 → 平面图坐标（分米） */
  function planPoint(e: React.PointerEvent): [number, number] {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }

  function begin(e: React.PointerEvent, target: Target, grip?: Grip) {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setSel(target);
    if (target.kind === "radar") {
      if (!canMoveRadar) return;
      dragRef.current = { target, start: planPoint(e), rect: { x0: 0, x1: 0, y0: 0, y1: 0 } };
      setRadarView({ view: [vx, vy, vw, vh], radar0: { ...room!.radar } });
      setDragging(true);
      return;
    }
    const rect = target.kind === "zone" ? zones[target.index]! : bound!;
    dragRef.current = { target, grip, start: planPoint(e), rect };
    setDragging(true);
  }

  function move(e: React.PointerEvent) {
    const pan = panRef.current;
    if (pan) {
      const dx = e.clientX - pan.x;
      const dy = e.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) < 3) return;
      if (!pan.moved) setPanning(true);
      pan.moved = true;
      setViewState({ key: viewKey, cx: pan.c[0] - dx * pan.u, cy: pan.c[1] - dy * pan.u, w: pan.w, h: pan.h });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const [px, py] = planPoint(e);
    if (drag.target.kind === "radar") {
      // 平面图坐标以当前雷达为原点，start 是按下时指针相对雷达的位置（抓住的那一点）：
      // 雷达的新位置 = 当前位置 + (指针相对当前雷达 − 抓住的那一点)，按 10 cm 取整；能不能放、侧装只能沿墙，由调用方限制
      if (!room || !onRadar) return;
      const nx = Math.round(px - drag.start[0]);
      const ny = Math.round(py - drag.start[1]);
      if (nx || ny) onRadar({ x: room.radar.x + nx * 10, y: room.radar.y + ny * 10 });
      return;
    }
    if (drag.target.kind === "bound") {
      if (!drag.grip || !onBound) return;
      const [dx, dy] = fromPlan(installType, facing, px, py);
      const b = aroundRadar(installType, resizeInside(drag.rect, drag.grip, Math.round(dx), Math.round(dy), limit));
      if (JSON.stringify(b) !== JSON.stringify(bound)) onBound(b);
      return;
    }
    const i = drag.target.index;
    const z = zones[i]!;
    const blocked = blockerOf(i, drag.rect);
    let r: DmRect;
    if (drag.grip) {
      const [dx, dy] = fromPlan(installType, facing, px, py);
      r = resizeTo(z, resizeInside(drag.rect, drag.grip, Math.round(dx), Math.round(dy), zoneLimit(z)), drag.grip, blocked);
    } else {
      // 平面图上的位移换成设备坐标的位移（只有旋转 / 镜像，没有平移）
      const [mx, my] = fromPlan(installType, facing, px - drag.start[0], py - drag.start[1]);
      r = slideTo(z, moveInside(drag.rect, Math.round(mx), Math.round(my), zoneLimit(z)), blocked);
    }
    if (r.x0 !== z.x0 || r.x1 !== z.x1 || r.y0 !== z.y0 || r.y1 !== z.y1) onZones(zones.map((q, j) => (j === i ? { ...q, ...r } : q)));
  }

  function end() {
    const pan = panRef.current;
    if (pan) {
      if (!pan.moved && pan.deselect) setSel(undefined);
      panRef.current = undefined;
      setPanning(false);
      return;
    }
    dragRef.current = undefined;
    setDragging(false);
    setRadarView(undefined);
  }

  /** 离 want 最近、和现有区域都不重叠的位置（按 10 cm 一圈圈往外找） */
  function freeSpot(want: DmRect, lim: DmRect): DmRect | undefined {
    const span = Math.max(lim.x1 - lim.x0, lim.y1 - lim.y0);
    for (let d = 0; d <= span; d++) {
      for (let dx = -d; dx <= d; dx++) {
        for (const dy of d === 0 ? [0] : Math.abs(dx) === d ? Array.from({ length: 2 * d + 1 }, (_, k) => k - d) : [-d, d]) {
          const r = moveInside(want, dx, dy, lim);
          if (!zones.some((q) => overlaps(q, r))) return r;
        }
      }
    }
    return undefined;
  }

  function add(t: ZoneType) {
    let id = 0;
    while (zones.some((z) => z.id === id)) id++;
    // 平面图上的宽高换成设备坐标的宽高，放在监测范围中间
    const [a, b] = fromPlan(installType, facing, t.size[0], t.size[1]);
    const w = Math.abs(a);
    const h = Math.abs(b);
    const lim = zoneLimit({ type: t.value });
    const cx = Math.round((lim.x0 + lim.x1) / 2 - w / 2);
    const cy = Math.round((lim.y0 + lim.y1) / 2 - h / 2);
    // 放在监测范围中间；被别的区域占了就从中间往外一圈圈找空位，找不到就不加
    const r = freeSpot({ x0: cx, x1: cx + w, y0: cy, y1: cy + h }, lim);
    if (!r) return setShifted(`监测范围里放不下新的${t.label}了，先把别的区域缩小或挪开`);
    setShifted(undefined);
    const next = [...zones, { id, type: t.value, ...r }];
    onZones(next);
    setSel({ kind: "zone", index: next.length - 1 });
  }

  /**
   * 删掉后按编号顺序重排成 0…n-1：平台下发按位置编号，留空号的话平台再下发一次编号就变了，
   * 场景引用的区域号会对不上（docs/room-device-model.md"区域编号有三个数"）。
   */
  function remove(i: number) {
    const gone = zones[i]?.id;
    const rest = zones.filter((_, j) => j !== i);
    const order = [...rest].sort((a, b) => a.id - b.id);
    const moved = order.filter((z, k) => z.id !== k).map((z) => z.id);
    onZones(rest.map((z) => ({ ...z, id: order.indexOf(z) })));
    setShifted(moved.length && gone !== undefined ? `删掉了编号 ${gone}，后面的编号 ${moved.join("、")} 各往前挪了一位。场景里引用这些编号的要跟着改` : undefined);
    setSel(undefined);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === " ") {
      e.preventDefault();
      if (!space) setSpace(true);
      return;
    }
    if (sel?.kind === "radar" && canMoveRadar) {
      const step = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key];
      if (!step) return;
      e.preventDefault();
      return onRadar!({ x: room!.radar.x + step[0]!, y: room!.radar.y + step[1]! });
    }
    if (disabled || sel?.kind !== "zone") return;
    const z = zones[sel.index];
    if (!z) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return remove(sel.index);
    }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    const [mx, my] = fromPlan(installType, facing, step[0]!, step[1]!);
    const r = slideTo(z, moveInside(z, mx, my, zoneLimit(z)), blockerOf(sel.index, z));
    onZones(zones.map((q, j) => (j === sel.index ? { ...q, ...r } : q)));
  }

  /** 一个矩形的拖柄：位置按设备的边算出来再换到平面图上 */
  function grips(r: DmRect, target: Target, allowed: (g: Grip) => boolean) {
    const mid = (a: number, b: number) => (a + b) / 2;
    return GRIPS.filter(allowed).map((g, k) => {
      const x = g.x ? r[g.x] : mid(r.x0, r.x1);
      const y = g.y ? r[g.y] : mid(r.y0, r.y1);
      const [X, Y] = P(x, y);
      const s = fs * 0.55;
      return <rect key={k} x={X - s / 2} y={Y - s / 2} width={s} height={s} className="zc-grip" onPointerDown={(e) => begin(e, target, g)} />;
    });
  }

  const selZone = sel?.kind === "zone" ? zones[sel.index] : undefined;
  const setZone = (p: Partial<CanvasZone>) => sel?.kind === "zone" && onZones(zones.map((q, j) => (j === sel.index ? { ...q, ...p } : q)));
  const pb = bound && planRect(bound);
  const lim = planRect(limit);
  const boundGrip = (g: Grip) => !g.x !== !g.y && !(g.y === "y0" && installType === 1);

  return (
    <div className="zc">
      <div className="zc-tools">
        {types.map((t) => (
          <Button key={t.value} size="small" icon={<PlusOutlined />} disabled={disabled || (t.value === 5 && zones.some((z) => z.type === 5)) || zones.length >= 16} onClick={() => add(t)}>
            <i className="zc-dot" style={{ background: t.color }} />
            {t.label}
          </Button>
        ))}
      </div>
      <div
        ref={stageRef}
        className="zc-stage"
        tabIndex={0}
        onKeyDown={onKey}
        onKeyUp={(e) => e.key === " " && setSpace(false)}
        onBlur={() => setSpace(false)}
        // 区域、拖柄的 pointerdown 里 preventDefault 了，浏览器不会再把焦点给画布，这里手动给，方向键和滚轮缩放才能用
        onPointerDownCapture={() => stageRef.current?.focus({ preventScroll: true })}
        // 中键按下默认会进入自动滚动
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      >
        <svg
          ref={svgRef}
          viewBox={`${vx} ${vy} ${vw} ${vh}`}
          preserveAspectRatio="xMidYMid meet"
          className={dragging || panning ? "dragging" : space ? "pan-ready" : ""}
          style={{ "--zc-z": zoom } as React.CSSProperties}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          // 空格 / 中键：在捕获阶段先拦下来平移，不让区域、雷达收到
          onPointerDownCapture={(e) => {
            if (e.button !== 1 && !(space && e.button === 0)) return;
            e.stopPropagation();
            beginPan(e, false);
          }}
          onPointerDown={(e) => e.button === 0 && beginPan(e, true)}
          role="application"
          aria-label="区域画布"
        >
          <defs>
            <pattern id={gridId} x={0} y={0} width={10} height={10} patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#E6E8F0" strokeWidth={0.15 / zoom} />
            </pattern>
          </defs>
          <rect x={vx} y={vy} width={vw} height={vh} fill={`url(#${gridId})`} />
          <rect x={lim.x} y={lim.y} width={lim.w} height={lim.h} className="zc-limit" />
          {/* 房间里的家具（装修）：按房间坐标（cm）画，换算到以雷达为原点的分米；只看不能点 */}
          {room && (
            <RoomBackdrop
              size={room}
              roomStyle={room.roomStyle}
              elements={room.elements}
              grid={false}
              outline={false}
              className="zc-backdrop"
              transform={`translate(${-room.radar.x / 10} ${-room.radar.y / 10}) scale(0.1)`}
              layer="base"
            />
          )}
          {roomRect && <rect x={roomRect.x} y={roomRect.y} width={roomRect.w} height={roomRect.h} className="zc-room" />}
          {room && (
            <RoomBackdrop size={room} elements={room.elements} className="zc-doors" transform={`translate(${-room.radar.x / 10} ${-room.radar.y / 10}) scale(0.1)`} layer="doors" />
          )}
          {bedRange &&
            (() => {
              const b = planRect(bedRange);
              return (
                <g className="zc-bedrange">
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} strokeDasharray={`${fs * 0.45} ${fs * 0.3}`} strokeWidth={fs * 0.09} />
                  <text x={b.x + b.w - fs * 0.3} y={b.y + b.h - fs * 0.4} fontSize={fs * 0.85} textAnchor="end">
                    监护床可画范围 {fmtM(b.w)} × {fmtM(b.h)} 米
                  </text>
                </g>
              );
            })()}
          {pb && (
            <g>
              <rect
                x={pb.x}
                y={pb.y}
                width={pb.w}
                height={pb.h}
                className={`zc-bound${sel?.kind === "bound" ? " on" : ""}`}
                // 监测范围框里本身不能拖（只能拖边），按住拖就是平移
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSel({ kind: "bound" });
                  if (e.button === 0) beginPan(e, false);
                }}
              />
              {onBound && !disabled && sel?.kind === "bound" && grips(bound!, { kind: "bound" }, boundGrip)}
            </g>
          )}
          {zones.map((z, i) => {
            const r = planRect(z);
            const t = typeOf(z.type);
            const on = sel?.kind === "zone" && sel.index === i;
            return (
              <g key={i}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={Math.max(r.w, 0.3)}
                  height={Math.max(r.h, 0.3)}
                  fill={t?.color ?? "#999"}
                  fillOpacity={z.type === 3 ? 0.12 : 0.28}
                  stroke={t?.color ?? "#999"}
                  strokeWidth={on ? fs * 0.18 : fs * 0.08}
                  strokeDasharray={z.type === 3 ? `${fs * 0.4} ${fs * 0.3}` : undefined}
                  className="zc-zone"
                  onPointerDown={(e) => begin(e, { kind: "zone", index: i })}
                />
                <text x={r.x + fs * 0.3} y={r.y + (r.h > fs * 1.6 ? fs * 1.1 : -fs * 0.35)} fontSize={fs} className="zc-label" fill={t?.color ?? "#666"}>
                  {z.id} {z.text || t?.label || `类型 ${z.type}`}
                </text>
              </g>
            );
          })}
          {selZone && !disabled && grips(selZone, sel!, () => true)}
          {(() => {
            // 箭头：设备正前方（设备坐标 y 增大的方向）在平面图上指向哪
            const [ax, ay] = P(0, fs * 1.8);
            return <line x1={0} y1={0} x2={ax} y2={ay} className="zc-look" />;
          })()}
          <circle
            cx={0}
            cy={0}
            r={fs * (canMoveRadar ? 0.6 : 0.5)}
            className={`zc-radar${canMoveRadar ? " movable" : ""}${sel?.kind === "radar" ? " on" : ""}`}
            onPointerDown={(e) => (canMoveRadar ? begin(e, { kind: "radar" }) : undefined)}
          >
            {canMoveRadar && <title>{installType === 1 ? "沿墙拖到实际安装的位置" : "拖到实际安装的位置"}</title>}
          </circle>
          {(() => {
            const [lx, ly] = installType === 1 ? P(0, -1) : [0, 1];
            return (
              <text x={lx * fs * 1.2} y={ly * fs * 1.2 + fs * 0.35} fontSize={fs} textAnchor="middle" className="zc-radar-text">
                雷达
              </text>
            );
          })()}
        </svg>
        <div className="zc-zoom" onPointerDown={(e) => e.stopPropagation()}>
          <Button size="small" type="text" icon={<ZoomOutOutlined />} title="缩小" disabled={zoom <= ZOOM_MIN + 1e-6} onClick={() => zoomBy(1 / 1.4)} />
          <span className="zc-zoom-pct">{Math.round(zoom * 100)}%</span>
          <Button size="small" type="text" icon={<ZoomInOutlined />} title="放大" disabled={zoom >= ZOOM_MAX - 1e-6} onClick={() => zoomBy(1.4)} />
          <Button size="small" type="text" title="缩放到能看到整个房间和所有区域" disabled={!view} onClick={() => setViewState(undefined)}>
            适应
          </Button>
        </div>
      </div>
      <div className="zc-info">
        {selZone ? (
          <>
            <i className="zc-dot" style={{ background: typeOf(selZone.type)?.color ?? "#999" }} />
            <Select
              size="small"
              value={selZone.type}
              disabled={disabled}
              popupMatchSelectWidth={false}
              options={types.map((t) => ({ value: t.value, label: t.label, disabled: t.value === 5 && selZone.type !== 5 && zones.some((z) => z.type === 5) }))}
              onChange={(v: number) => onZones(zones.map((q, j) => (sel?.kind === "zone" && j === sel.index ? { ...q, type: v, text: undefined, spaceType: undefined } : q)))}
            />
            {selZone.type === CUSTOM && spaceTypes && (
              <>
                <Input
                  size="small"
                  value={selZone.text ?? ""}
                  placeholder="名字，如马桶区"
                  maxLength={20}
                  disabled={disabled}
                  status={selZone.text?.trim() ? undefined : "warning"}
                  style={{ width: 120 }}
                  onChange={(e) => setZone({ text: e.target.value })}
                />
                <Select
                  size="small"
                  value={selZone.spaceType}
                  placeholder="空间区域类型"
                  allowClear
                  disabled={disabled}
                  popupMatchSelectWidth={false}
                  status={selZone.spaceType === undefined ? "warning" : undefined}
                  options={spaceTypes}
                  onChange={(v?: number) => setZone({ spaceType: v })}
                />
              </>
            )}
            <span className="zc-id" title="场景规则里用这个编号引用区域">
              编号 {selZone.id}
            </span>
            <span>
              {fmtM(planRect(selZone).w)} × {fmtM(planRect(selZone).h)} 米
            </span>
            <span className="grow" />
            <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={disabled} onClick={() => sel?.kind === "zone" && remove(sel.index)}>
              删除
            </Button>
          </>
        ) : sel?.kind === "radar" && room ? (
          <span>
            雷达离左墙 {fmtM(room.radar.x / 10)} 米、离上墙 {fmtM(room.radar.y / 10)} 米
            {canMoveRadar ? (installType === 1 ? "，沿墙拖动或按方向键（10 厘米）挪到实际安装的位置" : "，拖动或按方向键（10 厘米）挪到实际安装的位置") : ""}。区域和监测范围跟着雷达一起挪
          </span>
        ) : sel?.kind === "bound" && pb ? (
          <span>
            监测范围 {fmtM(pb.w)} × {fmtM(pb.h)} 米
            {onBound && !disabled ? "，拖边调整" : ""}
          </span>
        ) : (
          <span className="muted">
            拖动区域移动，选中后拖边角调大小，方向键微调 10 厘米；点虚线框可以调监测范围{canMoveRadar ? "；雷达也能拖，放到实际安装的位置" : ""}。
            {"Ctrl + 滚轮缩放（点过画布后直接滚轮），拖空白处、按住空格或中键拖动平移。"}
          </span>
        )}
      </div>
      {overlapPairs.length > 0 && <p className="pp-note warn">区域 {overlapPairs.join("、")} 重叠了（之前的配置），请拖开后再下发。</p>}
      {shifted && <p className="pp-note warn">{shifted}</p>}
    </div>
  );
}
