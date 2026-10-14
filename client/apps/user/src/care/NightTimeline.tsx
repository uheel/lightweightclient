import { useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import {
  presenceRuns,
  RADAR_PRESENCE,
  STAGE_ORDER,
  STAGES,
  type PostureSeg,
  type RadarPresence,
  type SleepReport,
  type StageKey,
  type VitalPoint,
} from "./health";

/**
 * 夜间时间线：睡眠结构、心率、呼吸三行共用一条时间轴（从上床到起床）。
 * 鼠标悬停时一条竖线贯穿三行，提示框显示该时刻的睡眠阶段、心率、呼吸。
 *
 * 心率呼吸数据来源（优先级从高到低）：
 * 1. 设备每分钟上报的记录 vitals（radar-vital-minute-pages）——设备原始数据，最可靠
 * 2. 睡眠报告附带的序列 hrPoints / brPoints（平台生成报告时加工的，偶有空缺：
 *    例如迪立莱 10-14 03:24 报告里为空，设备记录却有 64/11）
 * 3. 报告里的 heartRateTrend / breathingTrend（从入睡时间起每 10 分钟一个点，<= 0 表示没有数据）
 */
const TREND_STEP = 10 * 60_000;
const W = 1000;

function parseTime(t?: string) {
  if (!t) return undefined;
  const v = Date.parse(t.replace(" ", "T"));
  return Number.isNaN(v) ? undefined : v;
}

interface Point {
  t: number;
  v: number;
}

interface Series {
  label: string;
  unit: string;
  color: string;
  points: Point[];
  /** 相邻两点间隔超过这个值就断开连线、悬停时也不取值 */
  gap: number;
  avg?: number;
}

export default function NightTimeline({
  r,
  codes,
  vitals,
  postures,
}: {
  r: SleepReport;
  /** 睡眠分段 status → 阶段（两套编码由 stageCodesOf 判断） */
  codes: Record<number, StageKey>;
  vitals?: VitalPoint[];
  /** 雷达姿态（所有目标），用来画"雷达位置"一行，和睡眠报告对照 */
  postures?: PostureSeg[];
}) {
  const [hover, setHover] = useState<number>();
  const box = useRef<HTMLDivElement>(null);

  const segs = useMemo(() => [...(r.sleepDetails ?? [])].sort((a, b) => a.startTime - b.startTime), [r.sleepDetails]);
  const trendStart = parseTime(r.fallAsleepTime) ?? segs[0]?.startTime;

  const series: Series[] = useMemo(() => {
    const fromTrend = (vals?: number[]): Point[] =>
      trendStart === undefined ? [] : (vals ?? []).flatMap((v, i) => (v > 0 ? [{ t: trendStart + i * TREND_STEP, v }] : []));
    const useMinutes = !!vitals?.some((p) => p.hr || p.rr);
    const mk = (
      label: string,
      color: string,
      own: Point[] | undefined,
      minute: (p: VitalPoint) => number | undefined,
      trend?: number[],
      avg?: number,
    ): Series => {
      let points: Point[];
      let fine = true;
      if (useMinutes)
        points = (vitals ?? []).flatMap((p) => {
          const v = minute(p);
          return v ? [{ t: p.t, v }] : [];
        });
      else if (own?.length) points = own;
      else {
        points = fromTrend(trend);
        fine = false;
      }
      const mean = points.length ? Math.round(points.reduce((n, p) => n + p.v, 0) / points.length) : undefined;
      return { label, unit: "次/分", color, points, gap: fine ? 5 * 60_000 : TREND_STEP * 1.5, avg: avg ?? mean };
    };
    return [
      mk("心率", "#E5484D", r.hrPoints, (p) => p.hr, r.heartRateTrend, r.avgHeartRate),
      mk("呼吸", "#3B4FD8", r.brPoints, (p) => p.rr, r.breathingTrend, r.avgBreathingRate),
    ].filter((s) => s.points.length);
  }, [vitals, r.hrPoints, r.brPoints, r.heartRateTrend, r.breathingTrend, r.avgHeartRate, r.avgBreathingRate, trendStart]);

  // 共同的时间范围：睡眠分段、上床 / 起床时间、心率呼吸数据，取并集
  const starts = [segs[0]?.startTime, parseTime(r.bedTime), ...series.map((s) => s.points[0]?.t)].filter((x): x is number => x !== undefined);
  // 结束：报告的分段 / 起床时间，以及设备最后一次测到心率呼吸后 10 分钟（报告窗口截止后人可能还在床上）
  const lastVital = Math.max(0, ...series.map((s) => s.points[s.points.length - 1]?.t ?? 0));
  const ends = [segs.length ? segs[segs.length - 1].endTime : undefined, parseTime(r.getUpTime), lastVital ? Math.min(Date.now(), lastVital + 10 * 60_000) : undefined].filter(
    (x): x is number => x !== undefined,
  );
  if (!starts.length || !ends.length) return null;
  const t0 = Math.min(...starts);
  const t1 = Math.max(...ends, t0 + 60_000);
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  /** 报告统计窗口的结束时间；之后睡眠报告没有数据，只有设备数据 */
  const reportEnd = parseTime(r.endAt);
  const cutPct = reportEnd !== undefined && reportEnd < t1 ? ((reportEnd - t0) / (t1 - t0)) * 100 : undefined;
  // 雷达位置：有心率呼吸的分钟算在床（见 presenceRuns 的说明）
  // 判断在床：设备每分钟记录与报告附带序列取并集，任一份这一分钟有心率或呼吸就算在床；
  // 报告趋势每 10 分钟一个点，把这一点覆盖的 10 分钟都算上
  const vitalTimes = [
    ...(vitals ?? []).filter((p) => p.hr || p.rr).map((p) => p.t),
    ...[...(r.hrPoints ?? []), ...(r.brPoints ?? [])].map((p) => p.t),
    ...series.flatMap((s) =>
      s.points.flatMap((p) => (s.gap > 5 * 60_000 ? Array.from({ length: TREND_STEP / 60_000 }, (_, k) => p.t + k * 60_000) : [p.t])),
    ),
  ];
  const runs = postures?.length || vitalTimes.length ? presenceRuns(postures ?? [], t0, t1, vitalTimes) : undefined;

  // 整点刻度（范围太长时每 2 小时一个）
  const every = (t1 - t0) / 3_600_000 > 10 ? 2 : 1;
  const ticks: number[] = [];
  for (let t = dayjs(t0).startOf("hour").add(1, "hour"); t.valueOf() < t1; t = t.add(every, "hour")) ticks.push(t.valueOf());

  const onMove = (e: React.MouseEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(t0 + ratio * (t1 - t0));
  };

  /** 某一时刻的阶段和数值：阶段只看已知编码的分段，重叠时取画在最上层的那段；数值取最近的点（超过间隔视为无数据） */
  const at = (t: number) => {
    let seg: (typeof segs)[number] | undefined;
    for (const s of segs) if (codes[s.status] && t >= s.startTime && t < s.endTime) seg = s;
    const values = series.map((s) => {
      let best: Point | undefined;
      for (const p of s.points) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      return best && Math.abs(best.t - t) <= s.gap / 2 ? best.v : undefined;
    });
    const run = runs?.find((x) => t >= x.start && t < x.end);
    const targets = new Set((postures ?? []).filter((p) => t >= p.start && t < p.end).map((p) => p.userId)).size;
    const stageKey = seg ? codes[seg.status] : undefined;
    // 睡眠报告和雷达明显矛盾：报告说离床、雷达看到在床；或报告说在睡、雷达看到没人在床
    const conflict =
      !!run &&
      ((stageKey === "leave" && run.state === "bed") || ((stageKey === "deep" || stageKey === "light" || stageKey === "rem") && run.state !== "bed"));
    if (cutPct !== undefined && reportEnd !== undefined && t >= reportEnd) {
      return { stage: "报告未覆盖", leave: false, radar: run?.state as RadarPresence | undefined, targets, conflict: false, values };
    }
    return {
      stage: stageKey ? STAGES[stageKey].label : "无数据",
      leave: stageKey === "leave",
      radar: run?.state as RadarPresence | undefined,
      targets,
      conflict,
      values,
    };
  };
  const info = hover !== undefined ? at(hover) : undefined;
  const hoverPct = hover !== undefined ? ((hover - t0) / (t1 - t0)) * 100 : 0;
  const source = vitals?.some((p) => p.hr || p.rr)
    ? "设备每分钟记录"
    : r.hrPoints?.length || r.brPoints?.length
      ? "睡眠报告附带序列"
      : series.length
        ? "报告趋势（每 10 分钟）"
        : "";

  return (
    <div className="night">
      <div className="night-legend">
        {STAGE_ORDER.map((k) => (
          <span key={k}>
            <i style={{ background: STAGES[k].color }} />
            {STAGES[k].label}
          </span>
        ))}
        <span>
          <i style={{ background: "#F1F2F7", border: "1px solid #DADCE6" }} />
          无数据
        </span>
        {runs && (
          <>
            <span className="night-legend-sep">雷达：</span>
            {(["bed", "room"] as const).map((k) => (
              <span key={k}>
                <i style={{ background: RADAR_PRESENCE[k].color }} />
                {RADAR_PRESENCE[k].label}
              </span>
            ))}
          </>
        )}
      </div>

      <div className="night-body">
        <div className="night-labels">
          <span style={{ height: 30 }}>睡眠</span>
          {runs && <span style={{ height: 14 }}>雷达</span>}
          {series.map((s) => (
            <span key={s.label} style={{ height: 90, color: s.color }}>
              {s.label}
            </span>
          ))}
        </div>

        <div className="night-plot" ref={box} onMouseMove={onMove} onMouseLeave={() => setHover(undefined)}>
          <div className="night-stage">
            {cutPct !== undefined && <span className="night-uncovered" style={{ left: `${cutPct}%`, right: 0 }} title="睡眠报告未覆盖这段时间" />}
            {segs.map((s, i) => {
              const k = codes[s.status];
              return k ? (
                <span
                  key={i}
                  style={{ left: `${(x(s.startTime) / W) * 100}%`, width: `${((x(s.endTime) - x(s.startTime)) / W) * 100}%`, background: STAGES[k].color }}
                />
              ) : null;
            })}
          </div>

          {runs && (
            <div className="night-radar" role="img" aria-label="雷达位置">
              {runs
                .filter((x) => x.state !== "none")
                .map((x) => (
                  <span
                    key={x.start}
                    style={{ left: `${(((x.start - t0) / (t1 - t0)) * 100).toFixed(3)}%`, width: `${(((x.end - x.start) / (t1 - t0)) * 100).toFixed(3)}%`, background: RADAR_PRESENCE[x.state].color }}
                  />
                ))}
            </div>
          )}

          {series.map((s) => {
            const nums = s.points.map((p) => p.v);
            const lo = Math.min(...nums);
            const hi = Math.max(...nums);
            const pad = Math.max(2, (hi - lo) * 0.15);
            const y = (v: number) => 80 - ((v - (lo - pad)) / (hi - lo + pad * 2)) * 80;
            // 相邻点间隔超过 gap 就断开；前后都断开的孤立点画成小圆点（否则只有 M 没有 L，什么都画不出来）
            let d = "";
            const dots: Point[] = [];
            s.points.forEach((p, i) => {
              const linkPrev = i > 0 && p.t - s.points[i - 1].t <= s.gap;
              const linkNext = i < s.points.length - 1 && s.points[i + 1].t - p.t <= s.gap;
              const px = x(p.t).toFixed(1);
              const py = y(p.v).toFixed(1);
              if (linkPrev) d += `L${px} ${py} `;
              else if (linkNext) d += `M${px} ${py} `;
              else dots.push(p);
            });
            return (
              <div key={s.label} className="night-series">
                <span className="night-axis mono" style={{ top: y(hi) - 7 }}>
                  {hi}
                </span>
                <span className="night-axis mono" style={{ top: y(lo) - 7 }}>
                  {lo}
                </span>
                <svg viewBox={`0 0 ${W} 80`} preserveAspectRatio="none" aria-label={`${s.label}夜间趋势，范围 ${lo} 到 ${hi} ${s.unit}`} role="img">
                  <line x1="0" x2={W} y1={y(hi)} y2={y(hi)} stroke="#EEF0F5" vectorEffect="non-scaling-stroke" />
                  <line x1="0" x2={W} y1={y(lo)} y2={y(lo)} stroke="#EEF0F5" vectorEffect="non-scaling-stroke" />
                  <path d={d} fill="none" stroke={s.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
                {dots.map((p) => (
                  <i key={p.t} className="night-dot" style={{ left: `${(x(p.t) / W) * 100}%`, top: 5 + y(p.v), background: s.color }} />
                ))}
              </div>
            );
          })}

          <div className="night-ticks mono">
            <span style={{ left: 0 }}>{dayjs(t0).format("HH:mm")}</span>
            {ticks.map((t) => (
              <span key={t} style={{ left: `${(x(t) / W) * 100}%` }} className="tick">
                {dayjs(t).format("HH:mm")}
              </span>
            ))}
            <span style={{ right: 0 }}>{dayjs(t1).format("HH:mm")}</span>
          </div>
          {ticks.map((t) => (
            <i key={t} className="night-grid" style={{ left: `${(x(t) / W) * 100}%` }} />
          ))}
          {cutPct !== undefined && reportEnd !== undefined && (
            <i className="night-cut" style={{ left: `${cutPct}%` }}>
              <em>报告截止 {dayjs(reportEnd).format("HH:mm")}</em>
            </i>
          )}

          {hover !== undefined && info && (
            <>
              <i className="night-cursor" style={{ left: `${hoverPct}%` }} />
              <div className="night-tip" style={hoverPct > 70 ? { right: `${100 - hoverPct}%`, marginRight: 10 } : { left: `${hoverPct}%`, marginLeft: 10 }}>
                <b className="mono">{dayjs(hover).format("HH:mm")}</b>
                <div>
                  睡眠报告 <b>{info.stage}</b>
                </div>
                {runs && (
                  <div>
                    雷达 <b>{info.radar ? RADAR_PRESENCE[info.radar].label : "无数据"}</b>
                    {info.targets > 1 ? `（${info.targets} 个目标）` : ""}
                  </div>
                )}
                {info.conflict && <div className="night-tip-note warn">睡眠报告与雷达位置不一致</div>}
                {series.map((s, i) => (
                  <div key={s.label}>
                    <i style={{ background: s.color }} />
                    {s.label} <b className="mono">{info.values[i] ?? "—"}</b> {info.values[i] !== undefined ? s.unit : ""}
                  </div>
                ))}
                {/* 离床只表示不在床上：人离床后仍在雷达探测范围内活动时，平台照样记录心率呼吸，但活动中的数值不如静卧时准确 */}
                {info.leave && info.values.some((v) => v !== undefined) && <div className="night-tip-note">离床活动中测得，仅供参考</div>}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="night-summary">
        {series.map((s) => {
          const nums = s.points.map((p) => p.v);
          return (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label}：平均 <b className="mono">{s.avg}</b> {s.unit}，最低 <b className="mono">{Math.min(...nums)}</b>，最高{" "}
              <b className="mono">{Math.max(...nums)}</b>
            </span>
          );
        })}
        {!series.length && <span className="muted">这一晚没有心率呼吸数据</span>}
        {cutPct !== undefined && reportEnd !== undefined && lastVital > reportEnd && (
          <span className="report-cut-note">
            睡眠报告统计到 {dayjs(reportEnd).format("HH:mm")} 截止，设备最后测到心率呼吸是 {dayjs(lastVital).format("HH:mm")}
          </span>
        )}
        <span className="muted">
          鼠标移到图上查看每个时刻的数值{source ? ` · 心率呼吸来自${source}` : ""}
        </span>
      </div>
    </div>
  );
}
