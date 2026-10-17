import { fromPlan, limitOf, toPlan, type DmRect } from "./ZoneCanvas";

/**
 * 顶装 / 侧装互换：区域在房间里的位置不变（床、门都没动），只是雷达换了地方、换了坐标系。
 * - 改成顶装：雷达放到房间正中（吊顶）
 * - 改成侧装：雷达放到离原位置最近的那面墙的中点，朝房间里看（朝向就是那面墙）
 * - 不在房间布置里（不知道房间多大）时，雷达位置不变
 * 设备坐标都是分米、以雷达为原点；房间坐标是厘米。
 */

export interface MountRoom {
  width: number;
  height: number;
  /** 雷达在房间里的位置，cm */
  radar: { x: number; y: number };
}

export interface MountSwitch {
  /** 新的 QL_radar_config */
  config: number[];
  /** 新的 QL_radar_area */
  area: number[][];
  /** 新朝向（1 上 2 右 3 下 4 左） */
  facing: number;
  /** 雷达在房间里的新位置，cm；不在房间布置里时没有 */
  radar?: { x: number; y: number };
  /** 给用户的提示 */
  notes: string[];
}

const SIDE = 1;
const TOP = 0;

/** 侧装：四面墙的中点和对应的朝向编号（朝上 = 装在上墙往下看） */
function walls(room: MountRoom) {
  const { x, y } = room.radar;
  return [
    { facing: 1, dist: y, at: { x: room.width / 2, y: 0 } },
    { facing: 2, dist: room.width - x, at: { x: room.width, y: room.height / 2 } },
    { facing: 3, dist: room.height - y, at: { x: room.width / 2, y: room.height } },
    { facing: 4, dist: x, at: { x: 0, y: room.height / 2 } },
  ];
}

/** 离雷达最近的墙；距离一样时（例如在房间正中）按 上 → 右 → 下 → 左 的顺序取第一个 */
const nearestWall = (room: MountRoom) => walls(room).reduce((a, b) => (b.dist < a.dist - 1e-6 ? b : a));

const SIDE_NAME = ["", "上", "右", "下", "左"];
const FACE_NAME = ["", "朝上", "朝右", "朝下", "朝左"];

/** 两个矩形求交，没有交集时返回 undefined */
function intersect(a: DmRect, b: DmRect): DmRect | undefined {
  const r = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) };
  return r.x0 < r.x1 && r.y0 < r.y1 ? r : undefined;
}

/** 平面图上相对雷达的矩形（分米）→ 设备坐标矩形 */
function toDevice(installType: number, facing: number, x0: number, y0: number, x1: number, y1: number): DmRect {
  const [ax, ay] = fromPlan(installType, facing, x0, y0);
  const [bx, by] = fromPlan(installType, facing, x1, y1);
  return { x0: Math.round(Math.min(ax, bx)), x1: Math.round(Math.max(ax, bx)), y0: Math.round(Math.min(ay, by)), y1: Math.round(Math.max(ay, by)) };
}

const corners = (r: DmRect) => [r.x0, r.y0, r.x1, r.y0, r.x0, r.y1, r.x1, r.y1];

export function switchMount(opts: {
  config: number[];
  area: number[][];
  facing: number;
  room?: MountRoom;
  /** 新的安装方式 0 顶装 / 1 侧装 */
  to: number;
  /** 新朝向（1 上 2 右 3 下 4 左）：侧装是装在哪面墙，顶装是设备转的方向；不传时按装法自动定 */
  toFacing?: number;
}): MountSwitch {
  const { config, area, facing, room, to, toFacing } = opts;
  const from = config[0] === SIDE ? SIDE : TOP;
  const typeChanged = to !== from;
  const notes: string[] = [];
  let mode = config[10] ?? 15;
  let height = config[1] ?? 28;

  // 新的雷达位置和朝向
  let nf = toFacing ?? facing;
  let radar = room?.radar;
  if (to === TOP) {
    if (room && typeChanged) {
      radar = { x: room.width / 2, y: room.height / 2 };
      notes.push("雷达放到了房间正中（吊顶）");
    }
    if (toFacing && toFacing !== facing) notes.push(`雷达转成了${FACE_NAME[toFacing]}`);
  } else if (room && (typeChanged || (toFacing && toFacing !== facing))) {
    const w = toFacing ? walls(room).find((x) => x.facing === toFacing)! : nearestWall(room);
    radar = w.at;
    nf = w.facing;
    notes.push(`雷达放到了${SIDE_NAME[w.facing]}墙的中点，朝房间里看`);
  } else if (!room && toFacing && toFacing !== facing) notes.push(`雷达改成了装在${SIDE_NAME[toFacing]}墙`);
  // 雷达挪动的距离（平面图，分米）：区域在房间里不动，相对雷达就要反着挪
  const dx = room && radar ? (room.radar.x - radar.x) / 10 : 0;
  const dy = room && radar ? (room.radar.y - radar.y) / 10 : 0;

  if (typeChanged && to === TOP && mode === 11) {
    mode = 15;
    notes.push("呼吸睡眠只能侧装，工作模式改成了床位监护");
  }
  if (typeChanged && to === TOP && height < 22) {
    height = 28;
    notes.push("高度改成了 2.8 米，请按实际安装高度填写");
  }
  if (typeChanged && to === SIDE && (height < 15 || height > 35)) {
    height = Math.min(35, Math.max(15, height));
    notes.push(`侧装高度只能 1.5～3.5 米，改成了 ${height / 10} 米`);
  }

  const newArea = area.map((row) => {
    const [ax, ay] = toPlan(from, facing, row[2]!, row[3]!);
    const [bx, by] = toPlan(from, facing, row[8]!, row[9]!);
    const r = toDevice(to, nf, Math.min(ax, bx) + dx, Math.min(ay, by) + dy, Math.max(ax, bx) + dx, Math.max(ay, by) + dy);
    return [row[0]!, row[1]!, ...corners(r)];
  });

  // 监测范围：新装法的最大范围，有房间时裁到墙内
  const limit = limitOf(to, mode);
  let bound = limit;
  if (room && radar) {
    const walls = toDevice(to, nf, -radar.x / 10, -radar.y / 10, (room.width - radar.x) / 10, (room.height - radar.y) / 10);
    bound = intersect(limit, walls) ?? limit;
  }
  return { config: [to, height, ...corners(bound), mode], area: newArea, facing: nf, radar, notes };
}
