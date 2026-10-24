import type { ReactNode } from "react";
import { assetUrl } from "@radar/core";
import type { PlanElement } from "../../api/room";
import { furnitureOf, type FurnitureKind } from "./catalog";

/**
 * 家具俯视图标：都按元素自己的宽高（cm）现画，拉长拉宽后枕头、座位、椅子这些细节按真实尺寸重新排，不会变形。
 * 靠墙的一边在上（床头、沙发靠背、马桶水箱都朝上），转向用元素的 rotation。
 * 颜色全走 CSS 类：fur-body 主体、fur-soft 枕头坐垫等、fur-line 细节线、fur-dark 床头靠背等深色块
 */

type Draw = (w: number, h: number) => ReactNode;

const R = ({ x, y, w, h, r = 0, c = "fur-body" }: { x: number; y: number; w: number; h: number; r?: number; c?: string }) =>
  w > 0 && h > 0 ? <rect x={x} y={y} width={w} height={h} rx={Math.min(r, w / 2, h / 2)} className={c} /> : null;
const L = (x1: number, y1: number, x2: number, y2: number, c = "fur-line") => <line x1={x1} y1={y1} x2={x2} y2={y2} className={c} />;

function bed(w: number, h: number, nursing = false) {
  const head = Math.min(8, h * 0.05);
  const n = !nursing && w >= 130 ? 2 : 1;
  const gap = 6;
  const pw = (w - 12 - (n - 1) * gap) / n;
  const ph = Math.min(32, h * 0.15);
  const quilt = h * 0.34;
  return (
    <>
      <R x={0} y={0} w={w} h={h} r={4} />
      <R x={0} y={0} w={w} h={head} r={2} c="fur-dark" />
      {Array.from({ length: n }, (_, i) => (
        <R key={i} x={6 + i * (pw + gap)} y={head + 5} w={pw} h={ph} r={6} c="fur-soft" />
      ))}
      <R x={2} y={quilt} w={w - 4} h={h - quilt - 2} r={3} c="fur-soft" />
      {L(2, quilt + Math.min(16, h * 0.08), w - 2, quilt + Math.min(16, h * 0.08))}
      {nursing && (
        <>
          <R x={-3} y={h * 0.12} w={3} h={h * 0.4} c="fur-dark" />
          <R x={w} y={h * 0.12} w={3} h={h * 0.4} c="fur-dark" />
        </>
      )}
    </>
  );
}

/**
 * 门洞：沿门框（上边）画一条和底色一样的宽带，把房间外框和隔墙在门口"挖开"，看起来是打通的。
 * 隔墙 10 cm 厚，门框不管贴在墙的哪一边都能盖住；门在底图里最后画（见 RoomBackdrop），才盖得住墙
 */
const SILL = 22;
const sill = (w: number) => <rect x={0} y={-SILL / 2} width={w} height={SILL} className="fur-sill" />;

function sofa(w: number, h: number) {
  const arm = Math.min(16, w * 0.14);
  const back = Math.min(22, h * 0.26);
  const inner = w - arm * 2;
  const n = Math.max(1, Math.round(inner / 65));
  const sw = inner / n;
  return (
    <>
      <R x={0} y={0} w={w} h={h} r={8} />
      <R x={0} y={0} w={w} h={back} r={8} c="fur-dark" />
      <R x={0} y={0} w={arm} h={h} r={6} c="fur-dark" />
      <R x={w - arm} y={0} w={arm} h={h} r={6} c="fur-dark" />
      {Array.from({ length: n }, (_, i) => (
        <R key={i} x={arm + i * sw + 2} y={back + 2} w={sw - 4} h={h - back - 6} r={5} c="fur-soft" />
      ))}
    </>
  );
}

function cornerSofa(w: number, h: number) {
  const d = Math.min(90, w * 0.45, h * 0.6);
  const back = Math.min(20, d * 0.24);
  return (
    <>
      <path d={`M0 0 H${w} V${d} H${d} V${h} H0 Z`} className="fur-body" />
      <path d={`M0 0 H${w} V${back} H${back} V${h} H0 Z`} className="fur-dark" />
      <R x={back + 3} y={back + 3} w={d - back - 6} h={d - back - 6} r={5} c="fur-soft" />
      {(() => {
        const len = w - d;
        const n = Math.max(1, Math.round(len / 65));
        return Array.from({ length: n }, (_, i) => <R key={`h${i}`} x={d + (i * len) / n + 2} y={back + 3} w={len / n - 4} h={d - back - 6} r={5} c="fur-soft" />);
      })()}
      {(() => {
        const len = h - d;
        const n = Math.max(1, Math.round(len / 65));
        return Array.from({ length: n }, (_, i) => <R key={`v${i}`} x={back + 3} y={d + (i * len) / n + 2} w={d - back - 6} h={len / n - 4} r={5} c="fur-soft" />);
      })()}
    </>
  );
}

function diningTable(w: number, h: number) {
  const cd = Math.min(16, h * 0.18);
  const cw = 34;
  const square = w / h < 1.4 && h / w < 1.4;
  const tx = square ? cd + 2 : 4;
  const ty = cd + 2;
  const tw = w - tx * 2;
  const th = h - ty * 2;
  const along = (len: number) => Math.max(1, Math.floor(len / 60));
  const chairs: ReactNode[] = [];
  const row = (n: number, y: number) => {
    for (let i = 0; i < n; i++) chairs.push(<R key={`${y}-${i}`} x={tx + ((i + 0.5) * tw) / n - cw / 2} y={y} w={cw} h={cd} r={4} c="fur-soft" />);
  };
  row(along(tw), 0);
  row(along(tw), h - cd);
  if (square) {
    chairs.push(<R key="l" x={0} y={h / 2 - cw / 2} w={cd} h={cw} r={4} c="fur-soft" />);
    chairs.push(<R key="r" x={w - cd} y={h / 2 - cw / 2} w={cd} h={cw} r={4} c="fur-soft" />);
  }
  return (
    <>
      {chairs}
      <R x={tx} y={ty} w={tw} h={th} r={4} />
    </>
  );
}

function plant(w: number, h: number) {
  const r = Math.min(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  return (
    <>
      {Array.from({ length: 7 }, (_, i) => (
        <ellipse key={i} cx={cx} cy={cy - r * 0.5} rx={r * 0.22} ry={r * 0.48} transform={`rotate(${(i * 360) / 7} ${cx} ${cy})`} className="fur-plant" />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.28} className="fur-body" />
    </>
  );
}

const DRAW: Record<FurnitureKind, Draw> = {
  "bed-single": (w, h) => bed(w, h),
  "bed-double": (w, h) => bed(w, h),
  "bed-nursing": (w, h) => bed(w, h, true),
  nightstand: (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={3} />
      <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) * 0.24} className="fur-soft" />
      <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) * 0.07} className="fur-dark" />
    </>
  ),
  wardrobe: (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={2} />
      {L(5, h / 2, w - 5, h / 2)}
      {Array.from({ length: Math.max(1, Math.floor((w - 16) / 12)) }, (_, i) => {
        const x = 10 + i * 12;
        return <line key={i} x1={x - 3} y1={h * 0.22} x2={x + 3} y2={h * 0.78} className="fur-line" />;
      })}
    </>
  ),
  dresser: (w, h) => {
    const th = h * 0.62;
    const r = Math.min(h - th - 2, w * 0.2, 20) / 1.1;
    return (
      <>
        <R x={0} y={0} w={w} h={th} r={3} />
        <R x={w * 0.2} y={1.5} w={w * 0.6} h={Math.min(5, th * 0.12)} r={2} c="fur-dark" />
        <circle cx={w / 2} cy={h - r - 1} r={Math.max(r, 4)} className="fur-soft" />
      </>
    );
  },
  desk: (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={3} />
      <R x={w * 0.3} y={Math.min(6, h * 0.1)} w={w * 0.4} h={Math.min(4, h * 0.08)} r={1.5} c="fur-dark" />
      {L(4, h - 6, w - 4, h - 6)}
    </>
  ),
  chair: (w, h) => (
    <>
      <R x={w * 0.08} y={h * 0.18} w={w * 0.84} h={h * 0.78} r={Math.min(w, h) * 0.18} c="fur-soft" />
      <R x={w * 0.04} y={0} w={w * 0.92} h={h * 0.24} r={Math.min(w, h) * 0.1} c="fur-dark" />
    </>
  ),
  "sofa-1": sofa,
  "sofa-2": sofa,
  "sofa-3": sofa,
  "sofa-corner": cornerSofa,
  "coffee-table": (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={5} />
      <R x={6} y={6} w={w - 12} h={h - 12} r={3} c="fur-soft" />
    </>
  ),
  "tv-cabinet": (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={2} />
      {L(w / 3, 0, w / 3, h)}
      {L((w * 2) / 3, 0, (w * 2) / 3, h)}
      <R x={w * 0.2} y={h * 0.18} w={w * 0.6} h={Math.min(6, h * 0.18)} r={2} c="fur-dark" />
    </>
  ),
  tv: (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={2} c="fur-dark" />
      <R x={w * 0.42} y={h * 0.6} w={w * 0.16} h={h * 0.4} c="fur-body" />
    </>
  ),
  "dining-table": diningTable,
  cabinet: (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={2} />
      {L(3, h - 5, w - 3, h - 5)}
      {L(w / 2, 3, w / 2, h - 5)}
    </>
  ),
  plant,
  toilet: (w, h) => {
    const tank = h * 0.26;
    const by = tank + (h - tank) / 2;
    return (
      <>
        <R x={w * 0.06} y={0} w={w * 0.88} h={tank} r={3} />
        <ellipse cx={w / 2} cy={by} rx={w * 0.42} ry={(h - tank) / 2 - 1} className="fur-body" />
        <ellipse cx={w / 2} cy={by + 2} rx={w * 0.26} ry={(h - tank) / 2 - 8} className="fur-soft" />
      </>
    );
  },
  "squat-toilet": (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={4} />
      <ellipse cx={w / 2} cy={h / 2} rx={w * 0.3} ry={h * 0.38} className="fur-soft" />
      <circle cx={w / 2} cy={h * 0.26} r={Math.min(w, h) * 0.08} className="fur-dark" />
    </>
  ),
  basin: (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={3} />
      <ellipse cx={w / 2} cy={h * 0.56} rx={Math.min(w * 0.32, 24)} ry={h * 0.3} className="fur-soft" />
      <circle cx={w / 2} cy={h * 0.13} r={Math.min(3, h * 0.08)} className="fur-dark" />
    </>
  ),
  bathtub: (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={6} />
      <R x={6} y={6} w={w - 12} h={h - 12} r={Math.min(w, h) * 0.3} c="fur-soft" />
      <circle cx={w - 20} cy={h / 2} r={2.5} className="fur-dark" />
    </>
  ),
  shower: (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={2} />
      {L(0, 0, w, h)}
      {L(w, 0, 0, h)}
      <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) * 0.06} className="fur-dark" />
      <circle cx={Math.min(10, w * 0.12)} cy={Math.min(10, h * 0.12)} r={Math.min(4, w * 0.05)} className="fur-dark" />
    </>
  ),
  stove: (w, h) => {
    const r = Math.min(h * 0.3, w * 0.17);
    return (
      <>
        <R x={0} y={0} w={w} h={h} r={3} />
        {[0.28, 0.72].map((k) => (
          <g key={k}>
            <circle cx={w * k} cy={h / 2} r={r} className="fur-soft" />
            <circle cx={w * k} cy={h / 2} r={r * 0.4} className="fur-line" />
          </g>
        ))}
      </>
    );
  },
  fridge: (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={3} />
      {L(3, h * 0.84, w - 3, h * 0.84)}
      <R x={w * 0.62} y={h * 0.86} w={w * 0.22} h={Math.min(3, h * 0.06)} r={1} c="fur-dark" />
    </>
  ),
  "kitchen-cabinet": (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} r={2} />
      {L(3, h - 5, w - 3, h - 5)}
      <R x={w * 0.6} y={h * 0.2} w={Math.min(50, w * 0.3)} h={h * 0.5} r={4} c="fur-soft" />
    </>
  ),
  door: (w, h) => (
    <>
      {sill(w)}
      <path d={`M0 ${h} A${w} ${h} 0 0 0 ${w} 0`} className="fur-arc" />
      {L(0, 0, 0, h, "fur-leaf")}
    </>
  ),
  "door-right": (w, h) => (
    <>
      {sill(w)}
      <path d={`M0 0 A${w} ${h} 0 0 0 ${w} ${h}`} className="fur-arc" />
      {L(w, 0, w, h, "fur-leaf")}
    </>
  ),
  "double-door": (w, h) => (
    <>
      {sill(w)}
      <path d={`M0 ${h} A${w / 2} ${h} 0 0 0 ${w / 2} 0 A${w / 2} ${h} 0 0 0 ${w} ${h}`} className="fur-arc" />
      {L(0, 0, 0, h, "fur-leaf")}
      {L(w, 0, w, h, "fur-leaf")}
    </>
  ),
  window: (w, h) => (
    <>
      <R x={0} y={0} w={w} h={h} c="fur-window" />
      {L(0, h / 2, w, h / 2)}
    </>
  ),
  wall: (w, h) => <R x={0} y={0} w={w} h={h} c="fur-wall" />,
};

/** 某种家具在 (0,0)-(w,h) 里的图标（家具面板的小图也用它） */
export function FurnitureIcon({ kind, w, h }: { kind: FurnitureKind; w: number; h: number }) {
  const draw = DRAW[kind];
  return draw ? <>{draw(w, h)}</> : <R x={0} y={0} w={w} h={h} />;
}

/**
 * 平面图上的一件家具：认得出的按图标画，认不出的平台图片照原样画、矩形画成方框。
 * 平台的 rotation 以左上角为轴
 */
export function FurnitureShape({ e }: { e: PlanElement }) {
  const x = e.x ?? 0;
  const y = e.y ?? 0;
  const w = e.width ?? 0;
  const h = e.height ?? 0;
  const def = furnitureOf(e);
  const tf = `translate(${x} ${y})${e.rotation ? ` rotate(${e.rotation})` : ""}`;
  if (def)
    return (
      <g transform={tf} className="fur">
        <FurnitureIcon kind={def.kind} w={w} h={h} />
      </g>
    );
  if (e.type === 4 && e.src) return <image href={assetUrl(e.src)} x={0} y={0} width={w} height={h} transform={tf} preserveAspectRatio="none" opacity={0.7} />;
  if (e.type === 2) return <rect x={0} y={0} width={w} height={h} transform={tf} fill={e.fill && e.fill !== "#fff" ? e.fill : "none"} fillOpacity={0.3} stroke={e.stroke ?? "#B3B7C9"} strokeWidth={1} />;
  return null;
}
