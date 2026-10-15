import { ANGLE_STD, GRADE_COLOR, type evaluate, type Grade } from "../angle";

type Ev = ReturnType<typeof evaluate>;
const GREEN = "#1F9D55";
const MUTED = "#8A8FA8";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const axisOf = (ev: Ev, k: "x" | "y" | "z") => ev.axes.find((a) => a.k === k)!;
const worse = (a: Grade, b: Grade): Grade => (a === "bad" || b === "bad" ? "bad" : a === "warn" || b === "warn" ? "warn" : "ok");

/** 侧视图：侧装看俯角（90° − angle_y），顶装看 z 轴与水平面夹角 */
export function PitchView({ ev, type }: { ev?: Ev; type: number }) {
  const std = ANGLE_STD[type];
  const side = type === 1;
  const stdA = side ? 90 - std.axes.y : std.axes.z;
  const cur = ev ? (side ? 90 - axisOf(ev, "y").value : axisOf(ev, "z").value) : null;
  const grade = ev ? (side ? axisOf(ev, "y").grade : axisOf(ev, "z").grade) : undefined;
  const ox = side ? 30 : 100;
  const oy = side ? 30 : 36;
  const L = side ? 150 : 115;
  const ray = (a: number) => [ox + L * Math.cos((a * Math.PI) / 180), oy + L * Math.sin((a * Math.PI) / 180)] as const;
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = ray(a0);
    const [x1, y1] = ray(a1);
    return `M${ox},${oy} L${x0},${y0} A${L},${L} 0 0 1 ${x1},${y1} Z`;
  };
  const [sx, sy] = ray(stdA);
  const curEnd = cur != null ? ray(clamp(cur, -10, 190)) : null;
  return (
    <svg viewBox={`0 0 200 ${side ? 180 : 165}`} role="img" aria-label={side ? "侧视俯角" : "侧视 z 轴夹角"}>
      {side ? (
        <>
          <rect x={ox - 14} y={0} width={8} height={160} fill="#DCDFEA" />
          <text x={ox - 10} y={172} fontSize={10} textAnchor="middle" fill={MUTED}>
            墙
          </text>
        </>
      ) : (
        <>
          <rect x={0} y={oy - 16} width={200} height={8} fill="#DCDFEA" />
          <text x={6} y={oy - 20} fontSize={10} fill={MUTED}>
            天花板
          </text>
        </>
      )}
      <line x1={ox} y1={oy} x2={ox + (side ? 160 : 90)} y2={oy} stroke="#E8EAF2" strokeDasharray="3 3" />
      <path d={arc(stdA - std.tol, stdA + std.tol)} fill="rgba(31,157,85,.14)" />
      <line x1={ox} y1={oy} x2={sx} y2={sy} stroke={GREEN} strokeDasharray="5 4" />
      {curEnd && grade && <line x1={ox} y1={oy} x2={curEnd[0]} y2={curEnd[1]} stroke={GRADE_COLOR[grade]} strokeWidth={3} strokeLinecap="round" />}
      <rect x={ox - 7} y={oy - 5} width={14} height={10} rx={2} fill="#3B4FD8" />
      <text x={196} y={side ? 170 : 158} fontSize={12} textAnchor="end" fill="#1B1D2E">
        {side ? "俯角" : "z 轴"} {cur == null ? "--" : cur.toFixed(1) + "°"}
      </text>
      <text x={196} y={side ? 154 : 142} fontSize={11} textAnchor="end" fill={GREEN}>
        标准 {stdA}° ±{std.tol}°
      </text>
    </svg>
  );
}

/** 水平仪：两个轴相对标准值的偏差，绿色圆为允许范围 */
export function BubbleLevel({ ev, type }: { ev?: Ev; type: number }) {
  const [ka, kb] = type === 0 ? (["x", "y"] as const) : (["x", "z"] as const);
  const tol = ANGLE_STD[type].tol;
  const R = 80;
  const range = tol * 2.5;
  const sc = R / range;
  const cx = 100;
  const cy = 95;
  let bubble = null;
  if (ev) {
    const a = axisOf(ev, ka);
    const b = axisOf(ev, kb);
    const px = cx + clamp(a.dev, -range, range) * sc;
    const py = cy - clamp(b.dev, -range, range) * sc;
    bubble = <circle cx={px} cy={py} r={9} fill={GRADE_COLOR[worse(a.grade, b.grade)]} fillOpacity={0.85} stroke="#fff" strokeWidth={2} />;
  }
  return (
    <svg viewBox="0 0 200 195" role="img" aria-label={`水平仪 ${ka} / ${kb} 偏差`}>
      <circle cx={cx} cy={cy} r={R} fill="#F6F7FB" stroke="#DCDFEA" />
      <circle cx={cx} cy={cy} r={tol * sc} fill="rgba(31,157,85,.12)" stroke={GREEN} strokeDasharray="4 3" />
      <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="#E8EAF2" />
      <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="#E8EAF2" />
      <text x={cx + R - 2} y={cy - 4} fontSize={11} textAnchor="end" fill={MUTED}>
        {ka} +
      </text>
      <text x={cx + 4} y={cy - R + 12} fontSize={11} fill={MUTED}>
        {kb} +
      </text>
      <text x={cx + tol * sc + 3} y={cy + 12} fontSize={10} fill={GREEN}>
        ±{tol}°
      </text>
      {bubble}
      <text x={cx} y={190} fontSize={11} textAnchor="middle" fill={MUTED}>
        外圈 ±{range.toFixed(1)}°
      </text>
    </svg>
  );
}
