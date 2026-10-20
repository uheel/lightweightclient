import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented, Spin } from "antd";
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, QuestionCircleFilled } from "@ant-design/icons";
import dayjs from "dayjs";
import { getHeartbeats, getHeartbeatsSince, RECENT_HB_MS, type Heartbeat } from "../api/device";
import { ANGLE_STD, AXES, AXIS_COLOR, deg, evaluate, GRADE_COLOR, heartbeatInterval, signed, type Axis } from "./angle";
import { BubbleLevel, PitchView } from "./angleviews/Gauges";
import AttitudeView from "./angleviews/AttitudeView";

/**
 * 安装角度检查（移植自油猴脚本 room-install-angle.user.js）：
 * 结论、三轴明细、侧视俯角、水平仪、空间姿态、角度趋势。角度来自设备心跳，每 5 秒拉一次新心跳。
 */

const FMT = "YYYY-MM-DD HH:mm:ss";
const POLL_MS = 5000;
/** 超过 3 分钟没有新心跳，提示数据过期 */
const STALE_MS = 3 * 60 * 1000;
const WINDOW_KEY = "ops:angle-window";
const WINDOWS = [
  { label: "30 分钟", value: 30 },
  { label: "2 小时", value: 120 },
  { label: "6 小时", value: 360 },
  { label: "24 小时", value: 1440 },
  { label: "3 天", value: 4320 },
  { label: "7 天", value: 10080 },
];
/** 曲线区左右两列的宽度，与 styles.css 里 .angle-row 的 grid 列一致 */
const LABEL_W = 90;
const RANGE_W = 44;

function loadWindow() {
  try {
    const v = Number(localStorage.getItem(WINDOW_KEY));
    return WINDOWS.some((w) => w.value === v) ? v : 120;
  } catch {
    return 120;
  }
}

function fmtAgo(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

export default function AngleTab({ sn, installType, online }: { sn: string; installType?: number; online: boolean }) {
  const [minutes, setMinutes] = useState(loadWindow);
  const [override, setOverride] = useState<number>();
  const [list, setList] = useState<Heartbeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  /** 趋势图时间窗的终点：加载和收到新心跳时更新（不按秒刷新，避免整页每秒重绘） */
  const [windowEnd, setWindowEnd] = useState(Date.now());
  const listRef = useRef(list);
  listRef.current = list;

  const type = override ?? installType ?? 1;
  const std = ANGLE_STD[type];

  // 加载时间窗内的心跳；窗不到 2 小时且窗内没有时，取最近 2 小时里的最后几次上报
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(undefined);
    setList([]);
    (async () => {
      try {
        let hist = await getHeartbeats(sn, [dayjs().subtract(minutes, "minute").format(FMT), dayjs().add(1, "minute").format(FMT)], Math.min(30000, minutes * 2 + 20));
        if (!hist.length && minutes * 60e3 < RECENT_HB_MS) hist = await getHeartbeatsSince(sn);
        if (alive) {
          setList(hist);
          setWindowEnd(Date.now());
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sn, minutes]);

  // 每 5 秒拉上一条之后的新心跳，追加新的。上一次返回后才排下一次：平台慢的时候不会越堆越多、占满连接名额
  useEffect(() => {
    if (loading) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const last = listRef.current[listRef.current.length - 1];
        const rows = await getHeartbeatsSince(sn, last?.t ?? Date.now() - 10 * 60e3);
        const fresh = rows.filter((p) => !last || p.t > last.t);
        if (alive && fresh.length) {
          setList((l) => [...l, ...fresh]);
          setWindowEnd(Date.now());
        }
      } catch {
        /* 下次再试 */
      }
      if (alive) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [sn, loading]);

  const latest = list[list.length - 1];
  const ev = useMemo(() => (latest ? evaluate(latest, type) : undefined), [latest, type]);
  const axis = (k: Axis) => ev?.axes.find((a) => a.k === k);

  // 结论
  let verdict: { cls: string; icon: React.ReactNode; t1: string; t2: string };
  if (!ev) {
    verdict = {
      cls: "none",
      icon: <QuestionCircleFilled />,
      t1: loading ? "加载中…" : "暂无角度数据",
      t2: error ?? "这台设备最近没有上报带角度的心跳",
    };
  } else {
    const bad = ev.axes.filter((a) => a.grade === "bad");
    const warn = ev.axes.filter((a) => a.grade === "warn");
    verdict =
      ev.grade === "bad"
        ? {
            cls: "bad",
            icon: <CloseCircleFilled />,
            t1: "安装角度超出允许范围",
            t2: bad.map((a) => `${a.k} 轴偏差 ${signed(a.dev)}`).join("，") + `（允许 ±${ev.tol}°）`,
          }
        : ev.grade === "warn"
          ? {
              cls: "warn",
              icon: <ExclamationCircleFilled />,
              t1: "安装角度合格（接近临界）",
              t2: warn.map((a) => `${a.k} 轴偏差 ${signed(a.dev)}`).join("，") + "，已超过允许值的 75%",
            }
          : { cls: "ok", icon: <CheckCircleFilled />, t1: "安装角度合格", t2: `${std.name}标准：三轴偏差均在 ±${std.tol}° 内` };
  }

  const typeNote = override != null ? "已手动选择" : installType != null ? "来自房间布局配置" : "房间布局里没有配置安装方式，默认按侧装检查，可手动切换";

  return (
    <div className="detail-body">
      <div className="toolbar">
        <span className="muted small">安装方式</span>
        <Segmented
          options={[
            { label: "顶装", value: 0 },
            { label: "侧装", value: 1 },
          ]}
          value={type}
          onChange={(v) => setOverride(v as number)}
        />
        <span className="muted small">{typeNote}</span>
      </div>

      <div className={`verdict ${verdict.cls}`}>
        <span className="verdict-icon">{verdict.icon}</span>
        <div>
          <b>{verdict.t1}</b>
          <div>{verdict.t2}</div>
        </div>
      </div>

      <div className="angle-main">
        <div className="ops-card">
          <table className="angle-table">
            <thead>
              <tr>
                <th>轴</th>
                <th>当前值</th>
                <th>标准</th>
                <th>允许范围</th>
                <th>偏差</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {AXES.map((k) => {
                const a = axis(k);
                const sv = std.axes[k];
                return (
                  <tr key={k}>
                    <td className="mono">
                      <b>angle_{k}</b>
                    </td>
                    <td className="mono" style={{ color: a ? GRADE_COLOR[a.grade] : undefined, fontWeight: 600 }}>
                      {a ? deg(a.value, 2) : "--"}
                      {type === 1 && a && k === "y" && <div className="cell-note">俯角 {deg(90 - a.value)}（标准 {90 - sv}°）</div>}
                      {type === 1 && a && k === "z" && <div className="cell-note">y + z = {deg(axis("y")!.value + a.value)}（应为 90°）</div>}
                    </td>
                    <td className="mono">{sv}°</td>
                    <td className="mono">
                      {sv - std.tol}° ~ {sv + std.tol}°
                    </td>
                    <td className="mono">{a ? signed(a.dev, 2) : "--"}</td>
                    <td>{a ? <span className={`grade ${a.grade}`}>{a.grade === "bad" ? "超限" : a.grade === "warn" ? "临界" : "正常"}</span> : "--"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ReportMeta list={list} online={online} />
        </div>
        <div className="ops-card gauge">
          <h2>{type === 1 ? "侧视：俯角（90° − angle_y）" : "侧视：z 轴与水平面夹角"}</h2>
          <PitchView ev={ev} type={type} />
        </div>
        <div className="ops-card gauge">
          <h2>{type === 1 ? "水平仪：x / z 偏差" : "水平仪：x / y 偏差"}</h2>
          <BubbleLevel ev={ev} type={type} />
        </div>
      </div>

      <div className="ops-card">
        <h2>空间姿态</h2>
        <AttitudeView sample={latest} ev={ev} type={type} />
      </div>

      <div className="ops-card">
        <h2>
          角度趋势
          <Segmented
            size="small"
            options={WINDOWS}
            value={minutes}
            onChange={(v) => {
              setMinutes(v as number);
              try {
                localStorage.setItem(WINDOW_KEY, String(v));
              } catch {
                /* 忽略 */
              }
            }}
          />
        </h2>
        {loading ? <Spin style={{ margin: 30 }} /> : <AngleChart list={list} type={type} t0={windowEnd - minutes * 60e3} t1={windowEnd} />}
      </div>
    </div>
  );
}

/** 上报信息：最近上报多久前、预计下次上报。自己每秒刷新，不带动整页重绘 */
function ReportMeta({ list, online }: { list: Heartbeat[]; online: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const latest = list[list.length - 1];
  const meta: React.ReactNode[] = [];
  if (latest) {
    const age = now - latest.t;
    const next = heartbeatInterval(list) - age;
    meta.push(
      <span key="last">
        最近上报 <b>{dayjs(latest.t).format(FMT)}</b>（{fmtAgo(age)}）
      </span>,
      <span key="next">{next > 0 ? <>预计 <b>{Math.ceil(next / 1000)}</b> 秒后下次上报</> : `等待上报中（已超出预计 ${Math.ceil(-next / 1000)} 秒）`}</span>,
    );
    if (age > STALE_MS) meta.push(<span key="stale" className="danger">数据已过期，设备可能离线</span>);
    if (latest.fw) meta.push(<span key="fw">固件 {latest.fw}</span>);
    if (latest.rssi != null) meta.push(<span key="rssi">信号 {latest.rssi} dBm</span>);
  }
  if (!online) meta.push(<span key="off" className="danger">设备离线</span>);
  meta.push(
    <span key="live" className="live">
      <i />每 {POLL_MS / 1000} 秒自动刷新
    </span>,
  );
  return <div className="angle-meta">{meta}</div>;
}

function AngleChart({ list, type, t0, t1 }: { list: Heartbeat[]; type: number; t0: number; t1: number }) {
  const [hover, setHover] = useState<Heartbeat>();
  const std = ANGLE_STD[type];
  const pts = useMemo(() => list.filter((p) => p.t >= t0), [list, t0]);
  // 相邻点间隔超过 3 个心跳周期则断开折线
  const gap = heartbeatInterval(list) * 3;
  const W = 1000;
  const H = 90;
  const xOf = (t: number) => ((t - t0) / (t1 - t0)) * W;

  const outCount = { x: 0, y: 0, z: 0 };
  for (const p of pts) for (const k of AXES) if (Math.abs(p[k] - std.axes[k]) > std.tol) outCount[k]++;
  const outTotal = outCount.x + outCount.y + outCount.z;

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    // 只按中间的曲线区换算：左边是轴名，右边是刻度
    const r = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - r.left - LABEL_W) / (r.width - LABEL_W - RANGE_W);
    if (frac < 0 || frac > 1 || !pts.length) return setHover(undefined);
    const t = t0 + frac * (t1 - t0);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    setHover(best);
  }

  const hevs = hover ? evaluate(hover, type) : undefined;

  return (
    <>
      <p className="muted small">
        {pts.length} 次上报
        {outTotal
          ? `，其中 ${AXES.filter((k) => outCount[k])
              .map((k) => `${k} 轴超限 ${outCount[k]} 次`)
              .join("、")}（红点）`
          : pts.length
            ? "，全部在允许范围内"
            : "（这段时间没有上报，上方显示的是最近一次）"}
      </p>
      <div className="angle-chart" onMouseMove={onMove} onMouseLeave={() => setHover(undefined)}>
        {AXES.map((k) => {
          const sv = std.axes[k];
          // 纵轴至少覆盖 ±2 倍允许偏差，数据超出时再扩大
          let lo = sv - std.tol * 2;
          let hi = sv + std.tol * 2;
          for (const h of pts) {
            lo = Math.min(lo, h[k]);
            hi = Math.max(hi, h[k]);
          }
          const pad = (hi - lo) * 0.08;
          lo -= pad;
          hi += pad;
          const yOf = (v: number) => H - ((v - lo) / (hi - lo)) * H;
          const d = pts.map((p, i) => `${i && p.t - pts[i - 1].t <= gap ? "L" : "M"}${xOf(p.t).toFixed(1)},${yOf(p[k]).toFixed(1)}`).join("");
          return (
            <div key={k} className="angle-row">
              <div className="angle-label">
                <b style={{ color: AXIS_COLOR[k] }}>angle_{k}</b>
                <small>
                  {sv}° ±{std.tol}°
                </small>
              </div>
              <div className="angle-plot">
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`angle_${k} 曲线`}>
                  <rect x={0} y={yOf(sv + std.tol)} width={W} height={yOf(sv - std.tol) - yOf(sv + std.tol)} fill="rgba(31,157,85,.12)" />
                  <line x1={0} x2={W} y1={yOf(sv)} y2={yOf(sv)} stroke="rgba(31,157,85,.5)" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                  <path d={d} fill="none" stroke={AXIS_COLOR[k]} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  {hover && <line x1={xOf(hover.t)} x2={xOf(hover.t)} y1={0} y2={H} stroke="#1B1D2E" vectorEffect="non-scaling-stroke" />}
                </svg>
                {/* 超限点用 HTML 圆点画，避免被 SVG 拉伸成椭圆 */}
                {pts
                  .filter((p) => Math.abs(p[k] - sv) > std.tol)
                  .map((p) => (
                    <i key={p.t} className="out-dot" style={{ left: `${(xOf(p.t) / W) * 100}%`, top: `${(yOf(p[k]) / H) * 100}%` }} />
                  ))}
              </div>
              <span className="angle-range mono">
                {hi.toFixed(1)}
                <br />
                {lo.toFixed(1)}
              </span>
            </div>
          );
        })}
        <div className="angle-ticks">
          <span>{dayjs(t0).format("MM-DD HH:mm")}</span>
          <span>{dayjs(t1).format("MM-DD HH:mm")}</span>
        </div>
        {hover && hevs && (
          <div className="chart-tip" style={{ left: `calc(${LABEL_W}px + (100% - ${LABEL_W + RANGE_W}px) * ${xOf(hover.t) / W})` }}>
            <b>{dayjs(hover.t).format("MM-DD HH:mm:ss")}</b>
            {hevs.axes.map((a) => (
              <div key={a.k} style={{ color: a.grade === "bad" ? "#FF8A8A" : undefined }}>
                angle_{a.k}：{deg(a.value, 2)}（{signed(a.dev, 2)}）
              </div>
            ))}
            {hover.rssi != null && <div>信号：{hover.rssi} dBm</div>}
          </div>
        )}
      </div>
    </>
  );
}
