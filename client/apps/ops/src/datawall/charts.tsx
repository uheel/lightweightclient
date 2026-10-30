import dayjs from "dayjs";

/**
 * 数据魔墙的图表：手写 SVG，按 1920×1080 舞台的像素画（舞台整体缩放）。
 * 颜色都用 wall.css 里的变量；鼠标悬停用 SVG 自带的 title 提示（大屏通常没人操作）。
 */

const AXIS = { left: 56, right: 16, top: 20, bottom: 36 };

/** 好看的纵轴上限和刻度（3–5 格）。unit = 60 时按"小时"取整（数值是分钟） */
function niceMax(v: number, unit = 1): { max: number; step: number } {
  if (unit !== 1) {
    const r = niceMax(v / unit);
    return { max: r.max * unit, step: r.step * unit };
  }
  if (v <= 0) return { max: 1, step: 1 };
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw)!;
  return { max: Math.ceil(v / step) * step, step };
}

/** 横轴日期标签：最多放 8 个，最后一天总是标 */
function dayTicks(days: string[]) {
  const every = Math.max(1, Math.ceil(days.length / 8));
  return days.map((d, i) => ((days.length - 1 - i) % every === 0 ? dayjs(d).format("M/D") : ""));
}

function Grid({ w, h, max, step, fmt }: { w: number; h: number; max: number; step: number; fmt: (v: number) => string }) {
  const ih = h - AXIS.top - AXIS.bottom;
  const lines = [];
  for (let v = 0; v <= max + 1e-9; v += step) {
    const y = AXIS.top + ih - (v / max) * ih;
    lines.push(
      <g key={v}>
        <line x1={AXIS.left} x2={w - AXIS.right} y1={y} y2={y} className={v === 0 ? "wc-base" : "wc-grid"} />
        <text x={AXIS.left - 10} y={y + 5} textAnchor="end" className="wc-tick">
          {fmt(v)}
        </text>
      </g>,
    );
  }
  return <>{lines}</>;
}

function XLabels({ w, h, labels }: { w: number; h: number; labels: string[] }) {
  const iw = w - AXIS.left - AXIS.right;
  const bw = iw / labels.length;
  return (
    <>
      {labels.map((l, i) =>
        l ? (
          <text key={i} x={AXIS.left + bw * (i + 0.5)} y={h - 10} textAnchor="middle" className="wc-tick">
            {l}
          </text>
        ) : null,
      )}
    </>
  );
}

/** 按天的柱子（一个系列） */
export function DayBars({ days, values, w, h, fmt = (v) => String(v), unit = "" }: { days: string[]; values: (number | undefined)[]; w: number; h: number; fmt?: (v: number) => string; unit?: string }) {
  const { max, step } = niceMax(Math.max(0, ...values.map((v) => v ?? 0)));
  const iw = w - AXIS.left - AXIS.right;
  const ih = h - AXIS.top - AXIS.bottom;
  const bw = iw / days.length;
  const barW = Math.max(4, Math.min(36, bw - 6));
  const peak = values.reduce<number>((k, v, i) => ((v ?? -1) > (values[k] ?? -1) ? i : k), 0);
  return (
    <svg width={w} height={h} className="wc">
      <Grid w={w} h={h} max={max} step={step} fmt={fmt} />
      {values.map((v, i) => {
        if (!v) return null;
        const bh = (v / max) * ih;
        const x = AXIS.left + bw * i + (bw - barW) / 2;
        const y = AXIS.top + ih - bh;
        const r = Math.min(4, barW / 2, bh);
        return (
          <g key={i}>
            <path d={`M${x},${y + bh} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + bh} Z`} className="wc-bar">
              <title>{`${dayjs(days[i]).format("M月D日")}：${fmt(v)}${unit}`}</title>
            </path>
            {(i === peak || i === values.length - 1) && (
              <text x={x + barW / 2} y={y - 8} textAnchor="middle" className="wc-val">
                {fmt(v)}
              </text>
            )}
          </g>
        );
      })}
      <XLabels w={w} h={h} labels={dayTicks(days)} />
    </svg>
  );
}

/** 按天的折线（缺数据的天断开），可带一条目标线 */
export function DayLine({
  days,
  values,
  w,
  h,
  fmt = (v) => String(v),
  unit = "",
  target,
  label = fmt,
  minutes,
}: {
  days: string[];
  values: (number | undefined)[];
  w: number;
  h: number;
  /** 纵轴刻度的写法 */
  fmt?: (v: number) => string;
  unit?: string;
  target?: { value: number; label: string };
  /** 数据点标签、提示的写法（默认同刻度） */
  label?: (v: number) => string;
  /** 数值是分钟：超过 2 小时后刻度按整小时取 */
  minutes?: boolean;
}) {
  const top = Math.max(target?.value ?? 0, ...values.map((v) => v ?? 0));
  const { max, step } = niceMax(top, minutes && top > 120 ? 60 : 1);
  const iw = w - AXIS.left - AXIS.right;
  const ih = h - AXIS.top - AXIS.bottom;
  const bw = iw / days.length;
  const xy = (i: number, v: number) => [AXIS.left + bw * (i + 0.5), AXIS.top + ih - (v / max) * ih] as const;
  const runs: string[] = [];
  let cur = "";
  values.forEach((v, i) => {
    if (v === undefined) {
      if (cur) runs.push(cur);
      cur = "";
      return;
    }
    const [x, y] = xy(i, v);
    cur += `${cur ? "L" : "M"}${x},${y}`;
  });
  if (cur) runs.push(cur);
  const last = values.reduce<number>((k, v, i) => (v !== undefined ? i : k), -1);
  const ty = target ? AXIS.top + ih - (target.value / max) * ih : 0;
  return (
    <svg width={w} height={h} className="wc">
      <Grid w={w} h={h} max={max} step={step} fmt={fmt} />
      {target && (
        <g>
          <line x1={AXIS.left} x2={w - AXIS.right} y1={ty} y2={ty} className="wc-target" />
          <text x={AXIS.left + 8} y={ty - 8} className="wc-target-text">
            {target.label}
          </text>
        </g>
      )}
      {runs.map((d, i) => (
        <path key={i} d={d} className="wc-line" />
      ))}
      {values.map((v, i) => {
        if (v === undefined) return null;
        const [x, y] = xy(i, v);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={days.length > 14 ? 3 : 5} className="wc-dot" />
            <circle cx={x} cy={y} r={Math.max(10, bw / 2)} className="wc-hit">
              <title>{`${dayjs(days[i]).format("M月D日")}：${label(v)}${unit}`}</title>
            </circle>
            {i === last && (
              <text x={x} y={y - 12} textAnchor="end" className="wc-val">
                {label(v)}
                {unit}
              </text>
            )}
          </g>
        );
      })}
      <XLabels w={w} h={h} labels={dayTicks(days)} />
    </svg>
  );
}

/** 横向条形（名字在左、数值在右），按传入顺序 */
export function HBars({ items, w, fmt = (v) => String(v), total }: { items: { label: string; value: number }[]; w: number; fmt?: (v: number) => string; total?: number }) {
  const max = Math.max(1, ...items.map((x) => x.value));
  const sum = total ?? items.reduce((s, x) => s + x.value, 0);
  const labelW = 200;
  const valueW = 150;
  const row = 44;
  const bw = w - labelW - valueW;
  return (
    <svg width={w} height={items.length * row} className="wc">
      {items.map((x, i) => {
        const y = i * row;
        const len = Math.max(x.value ? 4 : 0, (x.value / max) * bw);
        return (
          <g key={x.label}>
            <text x={0} y={y + 27} className="wc-label">
              {x.label}
            </text>
            <rect x={labelW} y={y + 12} width={bw} height={18} rx={4} className="wc-track" />
            {len > 0 && (
              <rect x={labelW} y={y + 12} width={len} height={18} rx={4} className="wc-bar">
                <title>{`${x.label}：${fmt(x.value)}`}</title>
              </rect>
            )}
            <text x={w} y={y + 27} textAnchor="end" className="wc-val">
              {fmt(x.value)}
              <tspan className="wc-sub">{sum ? `  ${Math.round((x.value / sum) * 100)}%` : ""}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

/** 星期 × 小时热力图（单色：越多越亮） */
export function Heatmap({ grid, w, h }: { grid: number[][]; w: number; h: number }) {
  const left = 40;
  const bottom = 30;
  const cw = (w - left) / 24;
  const ch = (h - bottom) / 7;
  const max = Math.max(1, ...grid.flat());
  return (
    <svg width={w} height={h} className="wc">
      {grid.map((row, r) => (
        <g key={r}>
          <text x={left - 12} y={r * ch + ch / 2 + 6} textAnchor="end" className="wc-tick">
            {WEEK[r]}
          </text>
          {row.map((v, c) => (
            <rect
              key={c}
              x={left + c * cw + 1}
              y={r * ch + 1}
              width={cw - 2}
              height={ch - 2}
              rx={3}
              className={v ? "wc-cell" : "wc-cell0"}
              style={v ? { opacity: 0.18 + 0.82 * (v / max) } : undefined}
            >
              <title>{`周${WEEK[r]} ${c}:00–${c + 1}:00：${v} 条`}</title>
            </rect>
          ))}
        </g>
      ))}
      {[0, 3, 6, 9, 12, 15, 18, 21].map((hh) => (
        <text key={hh} x={left + hh * cw + 2} y={h - 6} className="wc-tick">
          {hh}时
        </text>
      ))}
    </svg>
  );
}

/** 百分比堆叠柱（每根柱 = 一段时间里各档人次的占比），档位颜色由 classes 给 */
export function StackCols({ cols, w, h, names }: { cols: { label: string; counts: number[] }[]; w: number; h: number; names: string[] }) {
  const ih = h - AXIS.top - AXIS.bottom;
  const iw = w - AXIS.left - AXIS.right;
  const bw = iw / Math.max(1, cols.length);
  const barW = Math.min(64, bw - 12);
  return (
    <svg width={w} height={h} className="wc">
      <Grid w={w} h={h} max={1} step={0.25} fmt={(v) => `${Math.round(v * 100)}%`} />
      {cols.map((c, i) => {
        const sum = c.counts.reduce((a, b) => a + b, 0);
        const x = AXIS.left + bw * i + (bw - barW) / 2;
        let y = AXIS.top + ih;
        return (
          <g key={i}>
            {sum === 0 && (
              <text x={x + barW / 2} y={AXIS.top + ih - 10} textAnchor="middle" className="wc-sub">
                无报告
              </text>
            )}
            {c.counts.map((n, k) => {
              if (!n) return null;
              const sh = (n / sum) * ih;
              y -= sh;
              return (
                <rect key={k} x={x} y={y + 1} width={barW} height={Math.max(0, sh - 2)} rx={3} className={`wc-band${k}`}>
                  <title>{`${c.label} ${names[k]}：${n} 人次（${Math.round((n / sum) * 100)}%）`}</title>
                </rect>
              );
            })}
            <text x={x + barW / 2} y={h - 10} textAnchor="middle" className="wc-tick">
              {c.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
