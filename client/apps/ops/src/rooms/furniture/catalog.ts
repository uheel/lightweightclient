import type { PlanElement } from "../../api/room";

/**
 * 装修用的家具目录。家具存在平台房间布置里（见 docs/room-decoration.md）：
 * 图库里有图的存成 type 4（src 填图库的图，平台网页端也能看），没有的存成 type 2 矩形；name 填中文名。
 * 平台会丢掉自定义字段，所以按 name → src 对照图库认出是哪种家具。
 */

export type FurnitureKind =
  | "bed-single"
  | "bed-double"
  | "bed-nursing"
  | "nightstand"
  | "wardrobe"
  | "dresser"
  | "desk"
  | "chair"
  | "sofa-1"
  | "sofa-2"
  | "sofa-3"
  | "sofa-corner"
  | "coffee-table"
  | "tv-cabinet"
  | "tv"
  | "dining-table"
  | "cabinet"
  | "plant"
  | "toilet"
  | "squat-toilet"
  | "basin"
  | "bathtub"
  | "shower"
  | "stove"
  | "fridge"
  | "kitchen-cabinet"
  | "door"
  | "door-right"
  | "double-door"
  | "window"
  | "wall";

export interface FurnitureDef {
  kind: FurnitureKind;
  /** 中文名，也是保存时的 name */
  label: string;
  group: string;
  /** 默认尺寸（cm）：宽 = 水平方向，长 = 垂直方向；靠墙的一边在上 */
  width: number;
  height: number;
  /** 保存时用的平台图库图片（imageUrl）；没有时存成矩形 */
  image?: string;
  /** 平台图库里也算这种家具的其他图片 */
  alias?: string[];
}

/** 平台图库 GET /api/room-element/list（2026-10-24 取，平台统一一份）里的 imageUrl */
export const FURNITURE: FurnitureDef[] = [
  { kind: "bed-single", label: "单人床", group: "卧室", width: 120, height: 200, image: "90f2e67d7a61428ab576b0062d478b69", alias: ["bdbce0537a47467ba6c575676a94c352"] },
  {
    kind: "bed-double",
    label: "双人床",
    group: "卧室",
    width: 150,
    height: 200,
    image: "5566c3fd45774585a3a0776dbd7e6c4c",
    alias: ["cda5f60a7162432b9ac320b8f5aaeb9c", "21ad571f4a034974aaea70f535f336be", "fd8136527b0c47bd9cf6398d9a0591d2", "fc53abcefa8a4c6481cc2d087eb7fc61", "714276c1189c4134aa1906d2061fd8de", "9263dadc7ae544dcac90c840f2d8e177", "bb222589d04a4412ad354eaa2e0c2916", "7f61e5943bc64bf6bd1b391f27c0de1d"],
  },
  // 图库没有护理床，平台上显示成单人床；客户端按 name 认
  { kind: "bed-nursing", label: "护理床", group: "卧室", width: 100, height: 210, image: "90f2e67d7a61428ab576b0062d478b69" },
  { kind: "nightstand", label: "床头柜", group: "卧室", width: 50, height: 45, image: "9824dd43b7584a5c86b072d43839153a", alias: ["b09438e60e7642da92180ded63902fc6", "1bb219abf1644287a5557d2ac873df7a", "42cc9814526c4f108f15e48cbf94d6f0"] },
  { kind: "wardrobe", label: "衣柜", group: "卧室", width: 120, height: 60, image: "fd93e2b39efe401eaaea77ef96059ba0", alias: ["81f9743b474f4f63834d3e7e347b2876", "71a8fee60d714327a52651a50b438596"] },
  { kind: "dresser", label: "梳妆台", group: "卧室", width: 100, height: 80, image: "e636a6a7624d4c989a0cfbeb852fa08d" },
  {
    kind: "desk",
    label: "书桌",
    group: "卧室",
    width: 120,
    height: 60,
    image: "4ce4d015c55a422a92e9240a1b4b238a",
    alias: ["07a86f8aca2a469ebf03c66258bfb450", "89d9c0383e864c8db73047cfaeea8e3c", "5747ceb8e6244259a475a5e4da84286b", "8a5bd7be43e74ce893ff50a14ea17aed", "002d8df9ae7d4ba8afbca236bb0c74dd", "d90cc018a9dc49948a0125708dc56281", "e8955cc147644e9bb8bbcc5f717afbd3"],
  },
  { kind: "chair", label: "椅子", group: "卧室", width: 50, height: 50, image: "219b6ed8fbf44786bd5d9294a002a61a", alias: ["ff503dec9e56459fb113c3773f77b85c", "a25e260828814b81838f552b8c279174", "69e9d4ee5d1542f18ce4be8ff7fd5832"] },

  {
    kind: "sofa-1",
    label: "单人沙发",
    group: "客厅",
    width: 90,
    height: 90,
    image: "fca1c7d848e5447a8ce4e16022524ac8",
    alias: ["fb12e246614f48b4815d8a6cece5b0bc", "9b96adc1208f48ec8ff24e3db83b1ddd", "5c59398511b6450cb19cabcfa0c6d1e6", "d913358098604224a55812923f536ecc", "71c5f79921e04f5e943eec146365faec", "19322a403a784bd19ef7f091153f71d2"],
  },
  { kind: "sofa-2", label: "双人沙发", group: "客厅", width: 140, height: 90, image: "5e11f250a3014816beac19d3b6ede48f", alias: ["e16a285cb7824514a32c345f33db4804", "a28371c89ced48c98f94f223c4bc19b6"] },
  {
    kind: "sofa-3",
    label: "三人沙发",
    group: "客厅",
    width: 210,
    height: 90,
    image: "0fcb85f7878e4d80b06355c7d6931756",
    alias: ["f6d069f8dfb442569a3bbb1551e3121a", "9a23f2631f9648429d18fad7e8d480d4", "db168ff486124d5d94fc9c7ed2078838", "335e9a1296bf45cea0089a78a69033e7"],
  },
  { kind: "sofa-corner", label: "转角沙发", group: "客厅", width: 250, height: 160, image: "a563e10781584cd5a44da9767f45fd03" },
  { kind: "coffee-table", label: "茶几", group: "客厅", width: 100, height: 60, image: "401e7bcd6630469aa5419d6308138008", alias: ["a60fff743f1646688a6c5d661b71104f"] },
  // 图库里"电视柜"和"橱柜"有一张是同一个文件（d752…），按电视柜认
  { kind: "tv-cabinet", label: "电视柜", group: "客厅", width: 180, height: 45, image: "adfa8c41bc054e258a7e3fa029f47a5e", alias: ["d7522099f7b045f2a2a1cf66d59386b4"] },
  { kind: "tv", label: "电视", group: "客厅", width: 120, height: 12, image: "25fe2b5f5d4b4aeeb3aeea9b4b604289", alias: ["3be126ce63704315952a2840857fefaf"] },
  {
    kind: "dining-table",
    label: "餐桌",
    group: "客厅",
    width: 140,
    height: 140,
    image: "262989c763de44c883e9874c2ac3571d",
    alias: ["11e01bcf1fda4c4b83eb05a0d55cc287", "c63b6d0713084b068ea7a2a1915cfb30", "3691abdf03b34789a4f80bf48f0e6ec1", "761017b0f814413bab9d2148069c0f6b", "edb894bf08f64ac8b7147f9c70b67585"],
  },
  { kind: "cabinet", label: "柜子", group: "客厅", width: 100, height: 45, image: "2cc397a74c764a91af5ec532d0e0f240", alias: ["f4a4833155164a029aedfe8b2d78de7a"] },
  { kind: "plant", label: "盆栽", group: "客厅", width: 50, height: 50, image: "be2375e7e7a14752884d65289bee39e9", alias: ["0fb0421815634b52b27a5b3ce1770864", "70367d63bb5644bbb9ea53aaf3ebee19", "edb0f83b3dbe4828987052e0b5743979"] },

  { kind: "toilet", label: "马桶", group: "卫浴", width: 45, height: 70, image: "a08fcf8c853b4d9c9a9f0f19eefd9987", alias: ["07df8f16c1f24d2b815ec89b0d748c11", "33cd2cbff5a64a0ebb742f2b006f6813", "491f9aa4d5e840ec86f2519944604dfb", "6e3becb916124e128843693b1842e350"] },
  { kind: "squat-toilet", label: "蹲便器", group: "卫浴", width: 45, height: 60, image: "4a5d89ba1b4040348fd040dd7967d428", alias: ["c8d710b2d98045379d49220b1494fdbf"] },
  { kind: "basin", label: "洗手台", group: "卫浴", width: 80, height: 50, image: "53cc388f495344f2917991038b6e2c49", alias: ["166152a7955e499bbeddbdc60af651c2", "7eb578cdc6f34ffdbb25b600065b0c60"] },
  { kind: "bathtub", label: "浴缸", group: "卫浴", width: 170, height: 75, image: "6a17b5d368094677a9a2122bc03ea59d", alias: ["a9b40700133647fda37bec81e596ffb9", "1c41caef381c4df4abbaba55f5bb1bb8"] },
  { kind: "shower", label: "淋浴", group: "卫浴", width: 90, height: 90 },

  { kind: "stove", label: "灶台", group: "厨房", width: 90, height: 50, image: "24ab8fbb37a74cd2a8194e1bb83cd6bb", alias: ["468b2210f5ed452686bfd2679434ec96", "cc21bbf589ce49079a19e964ad8fc7d2"] },
  { kind: "fridge", label: "冰箱", group: "厨房", width: 60, height: 60, image: "882e4ee24cc642e58aa77254597f5f41" },
  { kind: "kitchen-cabinet", label: "橱柜", group: "厨房", width: 180, height: 60, image: "c12af8ea672e476cacfdfc9aa47ce64f" },

  // 平台图库"门2"是左边铰链、"门1"是右边铰链（门框都在上边），平台存不下镜像，所以分两种
  { kind: "door", label: "门", group: "门窗墙", width: 90, height: 90, image: "3e5b604b7e504760a8a1f003aae9ce7d" },
  { kind: "door-right", label: "门（右开）", group: "门窗墙", width: 90, height: 90, image: "5ba5c6c39d8345fda600e253497dcabe" },
  { kind: "double-door", label: "双开门", group: "门窗墙", width: 150, height: 75, image: "100cd7831ed247aaa874f103118fddbb" },
  { kind: "window", label: "窗", group: "门窗墙", width: 120, height: 12 },
  { kind: "wall", label: "隔墙", group: "门窗墙", width: 200, height: 10 },
];

export const FURNITURE_GROUPS = [...new Set(FURNITURE.map((f) => f.group))];

const byKind = new Map(FURNITURE.map((f) => [f.kind, f]));
const byLabel = new Map(FURNITURE.map((f) => [f.label, f]));
const byImage = new Map<string, FurnitureDef>();
for (const f of FURNITURE) for (const id of [...(f.alias ?? []), ...(f.image ? [f.image] : [])]) if (!byImage.has(id)) byImage.set(id, f);

export const furnitureDef = (kind: FurnitureKind) => byKind.get(kind)!;

const imageId = (src?: string) => src?.match(/([0-9a-f]{32})(?:\?.*)?$/i)?.[1]?.toLowerCase();

/** 写实元素：平台图库里透明底的俯视照片，直接画图片，不换成线稿图标。默认宽度（cm），长度按图片比例算，不变形 */
export interface RealisticDef {
  /** 面板上的短名 */
  short: string;
  /** 保存时的 name，和线稿家具的名字区分开 */
  label: string;
  group: string;
  image: string;
  width: number;
  height: number;
}

const real = (group: string, short: string, image: string, width: number, height: number): RealisticDef => ({ short, label: `${short}（写实）`, group, image, width, height });

export const REALISTIC: RealisticDef[] = [
  real("卧室", "双人床1", "fd8136527b0c47bd9cf6398d9a0591d2", 180, 200),
  real("卧室", "双人床2", "21ad571f4a034974aaea70f535f336be", 180, 200),
  real("卧室", "双人床3", "fc53abcefa8a4c6481cc2d087eb7fc61", 180, 200),
  real("卧室", "双人床4", "714276c1189c4134aa1906d2061fd8de", 180, 200),
  real("卧室", "双人床5", "9263dadc7ae544dcac90c840f2d8e177", 150, 200),
  real("卧室", "双人床6", "bb222589d04a4412ad354eaa2e0c2916", 180, 200),
  real("卧室", "床", "cda5f60a7162432b9ac320b8f5aaeb9c", 150, 200),
  real("卧室", "单人床", "bdbce0537a47467ba6c575676a94c352", 120, 190),
  real("卧室", "床头柜1", "9824dd43b7584a5c86b072d43839153a", 50, 45),
  real("卧室", "床头柜2", "42cc9814526c4f108f15e48cbf94d6f0", 50, 45),
  real("卧室", "床头柜3", "b09438e60e7642da92180ded63902fc6", 50, 45),
  real("卧室", "床头柜4", "1bb219abf1644287a5557d2ac873df7a", 50, 45),
  real("卧室", "衣柜1", "71a8fee60d714327a52651a50b438596", 120, 60),
  real("卧室", "衣柜2", "81f9743b474f4f63834d3e7e347b2876", 120, 60),
  real("卧室", "书桌1", "07a86f8aca2a469ebf03c66258bfb450", 120, 60),
  real("卧室", "书桌2", "89d9c0383e864c8db73047cfaeea8e3c", 180, 36),
  real("卧室", "办公椅", "ff503dec9e56459fb113c3773f77b85c", 75, 80),
  real("卧室", "凳子", "69e9d4ee5d1542f18ce4be8ff7fd5832", 60, 60),

  real("客厅", "单人沙发1", "9b96adc1208f48ec8ff24e3db83b1ddd", 85, 85),
  real("客厅", "单人沙发2", "5c59398511b6450cb19cabcfa0c6d1e6", 80, 85),
  real("客厅", "单人沙发3", "d913358098604224a55812923f536ecc", 90, 90),
  real("客厅", "单人沙发4", "71c5f79921e04f5e943eec146365faec", 85, 90),
  real("客厅", "单人沙发5", "19322a403a784bd19ef7f091153f71d2", 85, 90),
  real("客厅", "双人沙发1", "e16a285cb7824514a32c345f33db4804", 140, 90),
  real("客厅", "双人沙发2", "a28371c89ced48c98f94f223c4bc19b6", 140, 90),
  real("客厅", "三人沙发1", "9a23f2631f9648429d18fad7e8d480d4", 210, 90),
  real("客厅", "三人沙发2", "db168ff486124d5d94fc9c7ed2078838", 240, 90),
  real("客厅", "三人沙发3", "335e9a1296bf45cea0089a78a69033e7", 210, 90),
  real("客厅", "三人沙发4", "f6d069f8dfb442569a3bbb1551e3121a", 200, 100),
  real("客厅", "茶几1", "401e7bcd6630469aa5419d6308138008", 100, 100),
  real("客厅", "茶几2", "a60fff743f1646688a6c5d661b71104f", 100, 100),
  real("客厅", "桌子", "5747ceb8e6244259a475a5e4da84286b", 160, 70),
  real("客厅", "餐桌1", "c63b6d0713084b068ea7a2a1915cfb30", 180, 150),
  real("客厅", "餐桌2", "3691abdf03b34789a4f80bf48f0e6ec1", 160, 110),
  real("客厅", "餐桌3", "761017b0f814413bab9d2148069c0f6b", 150, 150),
  real("客厅", "电视", "25fe2b5f5d4b4aeeb3aeea9b4b604289", 146, 30),
  real("客厅", "电视柜", "d7522099f7b045f2a2a1cf66d59386b4", 180, 45),
  real("客厅", "盆栽1", "0fb0421815634b52b27a5b3ce1770864", 60, 60),
  real("客厅", "盆栽2", "70367d63bb5644bbb9ea53aaf3ebee19", 60, 60),
  real("客厅", "盆栽3", "edb0f83b3dbe4828987052e0b5743979", 60, 60),

  real("卫浴", "马桶1", "07df8f16c1f24d2b815ec89b0d748c11", 45, 70),
  real("卫浴", "马桶2", "491f9aa4d5e840ec86f2519944604dfb", 45, 70),
  real("卫浴", "蹲便器", "c8d710b2d98045379d49220b1494fdbf", 45, 60),
  real("卫浴", "洗手池1", "166152a7955e499bbeddbdc60af651c2", 60, 45),
  real("卫浴", "洗手池2", "7eb578cdc6f34ffdbb25b600065b0c60", 60, 50),
  real("卫浴", "浴缸1", "a9b40700133647fda37bec81e596ffb9", 170, 75),
  real("卫浴", "浴缸2", "1c41caef381c4df4abbaba55f5bb1bb8", 160, 70),

  real("厨房", "灶台1", "24ab8fbb37a74cd2a8194e1bb83cd6bb", 90, 50),
  real("厨房", "灶台2", "cc21bbf589ce49079a19e964ad8fc7d2", 90, 50),
  real("厨房", "橱柜", "c12af8ea672e476cacfdfc9aa47ce64f", 180, 60),
];
export const REALISTIC_GROUPS = [...new Set(REALISTIC.map((f) => f.group))];
const realByImage = new Map(REALISTIC.map((f) => [f.image, f]));
const realByLabel = new Map(REALISTIC.map((f) => [f.label, f]));
export const realisticDef = (label: string) => realByLabel.get(label);

/** 布置里的元素是不是写实元素：我们存的按 name；平台网页端摆的没有 name，按 src 对照 */
export function realisticOf(e: PlanElement): RealisticDef | undefined {
  if (e.type !== 4) return undefined;
  if (e.name && byLabel.has(e.name)) return undefined;
  return (e.name ? realByLabel.get(e.name) : undefined) ?? realByImage.get(imageId(e.src) ?? "");
}

/** 布置里的元素是哪种家具：先看 name，再按 src 对照平台图库；写实照片不算（照原图画），认不出返回 undefined */
export function furnitureOf(e: PlanElement): FurnitureDef | undefined {
  if (e.type !== 4 && e.type !== 2) return undefined;
  const named = e.name ? byLabel.get(e.name) : undefined;
  if (named) return named;
  if (e.type !== 4) return undefined;
  const id = imageId(e.src) ?? "";
  return realByImage.has(id) ? undefined : byImage.get(id);
}

/** 图形：文字存 type 5；矩形、圆形存 type 2，靠 name 和线稿家具、平台画的矩形区分。圆形就是圆角 = 边长一半的正方形，平台也这样画 */
export type ShapeKind = "text" | "rect" | "circle";
export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: "text", label: "文字" },
  { kind: "rect", label: "矩形" },
  { kind: "circle", label: "圆形" },
];
export function shapeOf(e: PlanElement): ShapeKind | undefined {
  if (e.type === 5) return "text";
  if (e.type !== 2) return undefined;
  return e.name === "矩形" ? "rect" : e.name === "圆形" ? "circle" : undefined;
}

const DEFAULT_TEXT_SIZE = 14;
export const textFontSize = (e: PlanElement) => e.fontSize || DEFAULT_TEXT_SIZE;
/** 文字占多大（cm）：平台不存文字的实际宽度，按字数估，汉字 1 个字号宽，其他 0.6 个 */
export function textBox(text: string | undefined, fontSize: number) {
  const em = [...(text ?? "")].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 1 : 0.6), 0);
  return { width: Math.max(fontSize, Math.ceil(em * fontSize)), height: Math.ceil(fontSize * 1.2) };
}

export function newShape(kind: ShapeKind, id: string): PlanElement {
  const base = { id, x: 0, y: 0, rotation: 0 };
  if (kind === "text") return { ...base, type: 5, name: "文字", text: "文字", fontSize: 24, fill: "#5B6078", ...textBox("文字", 24) };
  const look = { type: 2, fill: "#E9ECF5", stroke: "#9AA0B8", strokeWidth: 1 };
  if (kind === "circle") return { ...base, ...look, name: "圆形", width: 80, height: 80, cornerRadius: 40 };
  return { ...base, ...look, name: "矩形", width: 100, height: 60, cornerRadius: 0 };
}

/** ratio：图片的长宽比（高 / 宽），知道就按它算长度，图不变形 */
export function newRealistic(def: RealisticDef, id: string, ratio?: number): PlanElement {
  return { id, type: 4, name: def.label, src: `/sapi/oss/${def.image}`, x: 0, y: 0, rotation: 0, width: def.width, height: ratio ? Math.round(def.width * ratio) : def.height };
}

/** 面板上显示的名字 */
export function elementLabel(e: PlanElement) {
  const shape = shapeOf(e);
  if (shape) return SHAPES.find((s) => s.kind === shape)!.label;
  return furnitureOf(e)?.label ?? realisticOf(e)?.label ?? (e.type === 4 ? "平台图片" : "矩形");
}

/** 门：在底图里放到墙和房间外框之后画，门洞才能把墙挖开 */
export const isDoor = (e: PlanElement) => {
  const k = furnitureOf(e)?.kind;
  return k === "door" || k === "door-right" || k === "double-door";
};

/** 装修编辑的元素：顶层的图片（type 4）、矩形（type 2）和文字（type 5），包括认不出的平台家具 */
export const isDecor = (e: PlanElement) => e.type === 4 || e.type === 2 || e.type === 5;

/** 房间在客户端装修过：有按我们目录命名的家具（客户端保存时都会写 name，平台网页端摆的没有） */
export const decoratedInClient = (elements?: PlanElement[]) => !!elements?.some((e) => isDecor(e) && !!e.name && (byLabel.has(e.name) || realByLabel.has(e.name) || !!shapeOf(e)));

/** 新摆一件家具：(x, y) 是左上角 */
export function newFurniture(def: FurnitureDef, id: string, x: number, y: number): PlanElement {
  const base = { id, name: def.label, x: Math.round(x), y: Math.round(y), width: def.width, height: def.height, rotation: 0 };
  return def.image ? { ...base, type: 4, src: `/sapi/oss/${def.image}` } : { ...base, type: 2, fill: "#F1F2F7", stroke: "#9AA0B8", strokeWidth: 1 };
}
