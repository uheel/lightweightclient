import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Segmented, Tooltip } from "antd";
import { FullscreenOutlined, LeftOutlined, PauseOutlined, CaretRightOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { isTauri, session } from "@radar/core";
import { useWallData } from "../datawall/data";
import { computeStats, RANGES, SCORE_BANDS, TIMELY_MINUTES, type RangeKey, type WallStats } from "../datawall/stats";
import { DayBars, DayLine, HBars, Heatmap, StackCols } from "../datawall/charts";
import { enterFullscreen, leaveFullscreen } from "../workspace/fullscreen";
import "../datawall/wall.css";

/** 舞台按 1920×1080 设计，整体等比缩放 */
const W = 1920;
const H = 1080;
/** 每页停留 */
const PAGE_MS = 20_000;
const RANGE_KEY = "ops.dataWall.range";

const pct = (v?: number) => (v === undefined ? "—" : `${Math.round(v * 100)}%`);
const num = (v?: number, d = 0) => (v === undefined ? "—" : v.toFixed(d));
/** 分钟 → "3.5 分钟" / "3 小时 46 分" */
function minText(v?: number) {
  if (v === undefined) return "—";
  if (v < 60) return `${v < 10 ? v.toFixed(1) : Math.round(v)} 分钟`;
  const m = Math.round(v);
  return `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ""}`;
}
/** 坐标轴上的分钟：90 → "1.5时" */
const minTick = (v: number) => (v < 60 ? `${v}分` : `${+(v / 60).toFixed(1)}小时`);
const hourTick = (v: number) => `${+(v / 60).toFixed(1)}小时`;

function Kpi({ label, value, unit, sub, tone }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className={`wall-kpi${tone ? ` wall-kpi-${tone}` : ""}`}>
      <div className="wall-kpi-label">{label}</div>
      <div className="wall-kpi-value">
        {value}
        {unit && <span className="wall-kpi-unit">{unit}</span>}
      </div>
      {sub && <div className="wall-kpi-sub">{sub}</div>}
    </div>
  );
}

function Panel({ title, note, children, style }: { title: string; note?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <section className="wall-panel" style={style}>
      <header>
        <h3>{title}</h3>
        {note && <span>{note}</span>}
      </header>
      <div className="wall-panel-body">{children}</div>
    </section>
  );
}

/** 面板尺寸（舞台像素）：一行两块，宽的 1104、窄的 712；两行，每行 352 */
const WIDE = 1104;
const NARROW = 712;
const ROW = 352;
/** 面板里图表的大小（减去内边距和标题） */
const cw = (pw: number) => pw - 48;
const CH = ROW - 48 - 44;

function OverviewPage({ st }: { st: WallStats }) {
  const a = st.alerts;
  const days = st.days.length;
  return (
    <>
      <div className="wall-kpis">
        <Kpi label="在住长者" value={st.members.total} unit="人" sub={`其中 ${st.members.sleepers} 人有睡眠监测`} />
        <Kpi label="床位入住率" value={pct(st.beds.total ? st.beds.occupied / st.beds.total : undefined)} sub={`${st.beds.occupied} / ${st.beds.total} 张床`} />
        <Kpi label="监测雷达在线" value={st.radars.online} unit={`/ ${st.radars.total} 台`} sub={`在线率 ${pct(st.radars.total ? st.radars.online / st.radars.total : undefined)}`} />
        <Kpi
          label="连续安全天数"
          value={`${st.safeDays.value}${st.safeDays.atLeast ? "+" : ""}`}
          unit="天"
          sub={st.safeDays.atLeast ? "统计范围内跌倒、坐地告警都及时处理" : `距最近一次跌倒 / 坐地告警超 ${TIMELY_MINUTES} 分钟才处理`}
          tone={st.safeDays.value >= 7 ? "good" : undefined}
        />
        <Kpi label="护理告警" value={a.total} unit="次" sub={`日均 ${num(a.total / days, 1)} 次`} />
        <Kpi label="平均睡眠评分" value={num(st.sleep.avgScore)} unit="分" sub={st.sleep.avgScore === undefined ? "暂无睡眠报告" : "按每人每晚的报告平均"} />
      </div>
      <div className="wall-grid">
        <Panel title="每日护理告警" note="场景、事件、紧急求助三类；不含设备离线" style={{ width: WIDE }}>
          <DayBars days={st.days} values={a.perDay} w={cw(WIDE)} h={CH} unit=" 次" />
        </Panel>
        <Panel title="告警类型" note={`共 ${a.total} 次`} style={{ width: NARROW }}>
          <HBars items={a.types} w={cw(NARROW)} />
        </Panel>
        <Panel title="长者年龄" note={st.members.ageUnknown ? `${st.members.ageUnknown} 人未填年龄` : undefined} style={{ width: NARROW }}>
          <HBars items={st.members.ageBuckets} w={cw(NARROW)} fmt={(v) => `${v} 人`} />
        </Panel>
        <Panel title="告警处理结果" note="已处理告警的处理类型" style={{ width: WIDE }}>
          <HBars items={a.processTypes} w={cw(WIDE)} fmt={(v) => `${v} 次`} />
        </Panel>
      </div>
    </>
  );
}

function AlertPage({ st }: { st: WallStats }) {
  const a = st.alerts;
  return (
    <>
      <div className="wall-kpis">
        <Kpi label="处理用时（中位数）" value={minText(a.lagMedian)} sub="从告警发生到点了处理" tone={a.lagMedian !== undefined && a.lagMedian <= TIMELY_MINUTES ? "good" : "bad"} />
        <Kpi label={`${TIMELY_MINUTES} 分钟内处理`} value={pct(a.timelyRate)} sub={`占全部 ${a.total} 次护理告警`} />
        <Kpi label="误报占比" value={pct(a.falseRate)} sub="处理类型为“误报”的比例" />
        <Kpi label="待处理" value={a.pending} unit="条" sub="近 31 天内还没处理的护理告警" tone={a.pending ? "bad" : "good"} />
      </div>
      <div className="wall-grid">
        <Panel title="每日处理用时（中位数）" note={`虚线为目标 ${TIMELY_MINUTES} 分钟`} style={{ width: WIDE }}>
          <DayLine days={st.days} values={a.lagPerDay} w={cw(WIDE)} h={CH} fmt={minTick} label={minText} minutes target={{ value: TIMELY_MINUTES, label: `目标 ${TIMELY_MINUTES} 分钟` }} />
        </Panel>
        <Panel title="处理用时分布" style={{ width: NARROW }}>
          <HBars items={a.lagBuckets} w={cw(NARROW)} fmt={(v) => `${v}`} />
        </Panel>
        <Panel title="告警时段分布" note="星期 × 小时，颜色越亮告警越多，可用来排班" style={{ width: W - 80 }}>
          <Heatmap grid={a.heat} w={W - 80 - 48} h={CH} />
        </Panel>
      </div>
    </>
  );
}

function SleepPage({ st }: { st: WallStats }) {
  const s = st.sleep;
  return (
    <>
      <div className="wall-kpis">
        <Kpi label="平均睡眠评分" value={num(s.avgScore)} unit="分" sub="≥80 良好 · 70–79 一般 · 60–69 偏低" />
        <Kpi label="平均每晚睡眠" value={minText(s.avgSleepMinutes)} sub="每人每晚睡着的时长" />
        <Kpi label="人均夜间离床" value={num(s.avgLeaveBed, 1)} unit="次 / 晚" sub="报告监测时段 20:00–08:00" />
        <Kpi label="报告覆盖" value={pct(s.coverage)} sub={`平均每晚有报告的人 / ${st.members.sleepers} 位有睡眠监测的长者`} />
      </div>
      <div className="wall-grid">
        <Panel
          title="睡眠评分分档"
          note={
            <span className="wall-legend">
              {SCORE_BANDS.map((b, i) => (
                <span key={b.label}>
                  <i className={`wall-sw wc-band${i}`} />
                  {b.label}
                </span>
              ))}
            </span>
          }
          style={{ width: WIDE }}
        >
          <StackCols cols={s.bands} w={cw(WIDE)} h={CH} names={SCORE_BANDS.map((b) => b.label)} />
        </Panel>
        <Panel title="人均夜间离床" style={{ width: NARROW }}>
          <DayBars days={st.days} values={s.perDayLeave.map((v) => (v === undefined ? undefined : +v.toFixed(1)))} w={cw(NARROW)} h={CH} unit=" 次" />
        </Panel>
        <Panel title="平均每晚睡眠时长" style={{ width: W - 80 }}>
          <DayLine days={st.days} values={s.perDayMinutes} w={W - 80 - 48} h={CH} fmt={hourTick} label={minText} minutes />
        </Panel>
      </div>
    </>
  );
}

const PAGES = [
  { title: "运营概况", render: (st: WallStats) => <OverviewPage st={st} /> },
  { title: "告警处置", render: (st: WallStats) => <AlertPage st={st} /> },
  { title: "睡眠健康", render: (st: WallStats) => <SleepPage st={st} /> },
];

/** 顶栏的时钟单独每秒刷新，不带着图表一起重画 */
function Clock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="wall-clock">
      <b>{dayjs(now).format("HH:mm:ss")}</b>
      <span>{dayjs(now).format("YYYY年M月D日")} 星期{"日一二三四五六"[dayjs(now).day()]}</span>
    </div>
  );
}

/** 舞台：铺满容器，1920×1080 等比缩放居中 */
function Stage({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = box.current!;
    const fit = () => setK(Math.min(el.clientWidth / W, el.clientHeight / H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="wall-stage-box">
      <div className="wall-stage" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${k})` }}>
        {children}
      </div>
    </div>
  );
}

/**
 * 数据魔墙 · 运营展示墙（大厅、来访参观、汇报用）：三页自动轮播，全是汇总数字，不出现长者姓名。
 * 数据口径见 docs/data-wall.md 第 3 节；取数见 datawall/data.ts，统计见 datawall/stats.ts。
 */
export default function DataWallPage() {
  const s = session.get()!;
  const { data, error, loading, sleep, refresh } = useWallData(s.orgId);
  const [range, setRange] = useState<RangeKey>(() => {
    try {
      return (localStorage.getItem(RANGE_KEY) as RangeKey) || "30";
    } catch {
      return "30";
    }
  });
  const [page, setPage] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [show, setShow] = useState(false);

  const st = useMemo(() => (data ? computeStats(data, range, data.loadedAt) : undefined), [data, range]);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setPage((p) => (p + 1) % PAGES.length), PAGE_MS);
    return () => clearTimeout(t);
  }, [playing, page]);

  const pickRange = (k: RangeKey) => {
    setRange(k);
    try {
      localStorage.setItem(RANGE_KEY, k);
    } catch {
      /* 只是记住选择 */
    }
  };

  async function startShow() {
    setShow(true);
    setPlaying(true);
    await enterFullscreen().catch(() => {});
  }
  async function endShow() {
    setShow(false);
    await leaveFullscreen().catch(() => {});
  }
  // 放映时 Esc 退出；左右键翻页
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endShow();
      else if (e.key === "ArrowRight") setPage((p) => (p + 1) % PAGES.length);
      else if (e.key === "ArrowLeft") setPage((p) => (p + PAGES.length - 1) % PAGES.length);
    };
    // 浏览器调试时 Esc 由浏览器先退出网页全屏
    const onFs = () => !document.fullscreenElement && !isTauri && setShow(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [show]);
  // 离开页面（关标签、切机构）时恢复窗口
  useEffect(() => () => void leaveFullscreen().catch(() => {}), []);

  const rangeLabel = RANGES.find((r) => r.key === range)!.label;
  const sleepNote =
    st && st.sleep.expected
      ? st.sleep.fetched < st.sleep.expected
        ? `睡眠报告补取中 ${st.sleep.fetched} / ${st.sleep.expected} 人晚`
        : st.sleep.firstDay && st.sleep.firstDay !== st.days[0]
          ? `睡眠统计自 ${dayjs(st.sleep.firstDay).format("M月D日")}起（之前没有报告）`
          : ""
      : "";

  const wall = (
    <div className="wall">
      <Stage>
        <header className="wall-head">
          <div className="wall-org">
            <b>{s.orgName}</b>
            <span>运营展示 · {rangeLabel}</span>
          </div>
          <div className="wall-title">
            <h1>{PAGES[page].title}</h1>
            <div className="wall-dots">
              {PAGES.map((p, i) => (
                <i key={p.title} className={i === page ? "on" : ""} onClick={() => setPage(i)} />
              ))}
            </div>
          </div>
          <Clock />
        </header>
        <main className="wall-body" key={page}>
          {st ? PAGES[page].render(st) : <div className="wall-empty">{error ? `取数失败：${error}` : "正在取数…"}</div>}
        </main>
        <footer className="wall-foot">
          <span>数据来自设备与告警原始记录，由本机统计{data ? ` · 更新于 ${dayjs(data.loadedAt).format("HH:mm")}` : ""}</span>
          <span>{sleepNote}</span>
        </footer>
      </Stage>
      {show && (
        <button className="wall-exit" onClick={endShow} title="退出放映（Esc）">
          退出放映
        </button>
      )}
    </div>
  );

  if (show) return <div className="wall-show">{wall}</div>;

  return (
    <div className="wall-page">
      <div className="wall-bar">
        <Segmented size="small" value={range} onChange={(v) => pickRange(v as RangeKey)} options={RANGES.map((r) => ({ value: r.key, label: r.label }))} />
        <span className="wall-bar-sep" />
        <Button size="small" icon={<LeftOutlined />} onClick={() => setPage((p) => (p + PAGES.length - 1) % PAGES.length)} />
        <Button size="small" icon={playing ? <PauseOutlined /> : <CaretRightOutlined />} onClick={() => setPlaying((x) => !x)}>
          {playing ? "暂停轮播" : "继续轮播"}
        </Button>
        <Button size="small" icon={<RightOutlined />} onClick={() => setPage((p) => (p + 1) % PAGES.length)} />
        <span className="wall-bar-sep" />
        <Tooltip title={sleep.total > sleep.done ? `睡眠报告 ${sleep.done} / ${sleep.total}` : undefined}>
          <Button size="small" icon={<ReloadOutlined spin={loading} />} onClick={refresh}>
            刷新
          </Button>
        </Tooltip>
        <Button size="small" type="primary" icon={<FullscreenOutlined />} onClick={startShow}>
          全屏放映
        </Button>
      </div>
      {wall}
    </div>
  );
}
