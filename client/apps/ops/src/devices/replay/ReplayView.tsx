import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Checkbox, DatePicker, Empty, Select, Tooltip } from "antd";
import {
  CaretRightOutlined,
  CompressOutlined,
  MinusOutlined,
  PauseOutlined,
  PlusOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  VerticalRightOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { perfTimer } from "@radar/core";
import { fmt, fmtDate, fmtTime, getRoomDetail, lowerBound, MAX_RANGE_DAYS, POSTURES, trackStateAt, loadReplayData, type Mark, type ReplayData, type RoomDetail } from "./data";
import { ReplayEngine, type ReplayOptions, type ReplayPalette } from "./engine";

const OPTS_KEY = "ops:replay-options";
const SPEEDS = [0.5, 1, 2, 5, 10, 30, 60, 120];
const TRAILS = [0, 5, 10, 30, 60, 300];
const QUICK: { key: string; label: string; range: () => [number, number] }[] = [
  { key: "1h", label: "近 1 小时", range: () => [Date.now() - 36e5, Date.now()] },
  { key: "6h", label: "近 6 小时", range: () => [Date.now() - 6 * 36e5, Date.now()] },
  { key: "24h", label: "近 24 小时", range: () => [Date.now() - 864e5, Date.now()] },
  { key: "today", label: "今天", range: () => [dayjs().startOf("day").valueOf(), Date.now()] },
  { key: "yesterday", label: "昨天", range: () => [dayjs().subtract(1, "day").startOf("day").valueOf(), dayjs().startOf("day").valueOf()] },
  { key: "7d", label: "近 7 天", range: () => [Date.now() - 7 * 864e5, Date.now()] },
];

/** 播放时间：只让依赖时间的小组件订阅，播放时不必整页重渲染 */
function createClock() {
  let t = 0;
  const subs = new Set<() => void>();
  return {
    get: () => t,
    set(v: number) {
      t = v;
      for (const f of subs) f();
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };
}
type Clock = ReturnType<typeof createClock>;
const useClock = (clock: Clock) => useSyncExternalStore(clock.subscribe, clock.get);

function loadOpts(): ReplayOptions {
  const def: ReplayOptions = { speed: 1, trail: 10, skip: true, follow: true };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(OPTS_KEY) || "{}") };
  } catch {
    return def;
  }
}

/** 设备页每秒随实时推送重渲染一次，回放面板的 props 不变就不跟着重渲染 */
export default memo(ReplayView);

/**
 * 姿态回放（移植自油猴脚本 room-posture-replay.user.js）：
 * 任选时间段（可跨天，最多 7 天）复现房间里的人员轨迹与姿态，时间轴可缩放，事件 / 告警可逐个跳转。
 * 回放以房间为单位，默认只选当前设备，同房间的其他雷达可以勾选一起看。
 */
function ReplayView({ roomId, sn, dark, palette, fill }: { roomId?: string; /** 先看哪台设备；不传 = 房间里全部设备一起看（卧室、卫生间各一台时人在两台之间走动） */ sn?: string; /** 深色（监控模式） */ dark?: boolean; /** 深色时画布用的配色（监控模式的配色方案），不传用默认深色 */ palette?: ReplayPalette; /** 撑满父元素的高度（弹窗里用），画布区占满剩下的空间 */ fill?: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const roomBase = useRef<HTMLCanvasElement>(null);
  const roomDyn = useRef<HTMLCanvasElement>(null);
  const tlWrap = useRef<HTMLDivElement>(null);
  const tlBase = useRef<HTMLCanvasElement>(null);
  const tlOver = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const engine = useRef<ReplayEngine | null>(null);

  const [opts, setOpts] = useState<ReplayOptions>(loadOpts);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf("day"), dayjs()]);
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [roomError, setRoomError] = useState<string>();
  const [sns, setSns] = useState<string[]>(sn ? [sn] : []);
  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean }>();
  const [clock] = useState(createClock);
  const [playing, setPlaying] = useState(false);
  const [span, setSpan] = useState("");
  const [q, setQ] = useState<[number, number]>([0, 0]);

  // 画布引擎；没绑定房间 / 房间加载失败时只显示提示，没有画布
  const hasStage = !!roomId && !roomError;
  useEffect(() => {
    if (!hasStage) return;
    const e = new ReplayEngine(
      { stage: stage.current!, roomBase: roomBase.current!, roomDyn: roomDyn.current!, tlWrap: tlWrap.current!, tlBase: tlBase.current!, tlOver: tlOver.current!, tip: tip.current! },
      () => optsRef.current,
      { onTime: clock.set, onPlaying: setPlaying, onView: setSpan },
      [dayjs().startOf("day").valueOf(), Date.now()],
      dark && palette ? palette : !!dark,
    );
    engine.current = e;
    e.setRadars(sns);
    return () => {
      e.destroy();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStage]);

  useEffect(() => {
    engine.current?.setRadars(sns);
  }, [sns]);

  useEffect(() => {
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify(opts));
    } catch {
      /* 忽略 */
    }
    engine.current?.refresh();
  }, [opts]);

  async function query(r: [number, number] = [range[0].valueOf(), range[1].valueOf()], d = detail, list = sns) {
    const [start, end] = r;
    if (!roomId || !d) return;
    if (end <= start) return setMsg({ text: "结束时间要晚于开始时间", err: true });
    if (end - start > MAX_RANGE_DAYS * 864e5) return setMsg({ text: `时间段不能超过 ${MAX_RANGE_DAYS} 天`, err: true });
    if (!list.length) return setMsg({ text: "请至少选择一台设备", err: true });
    engine.current?.pause();
    setLoading(true);
    setMsg({ text: "加载中…" });
    try {
      const pt = perfTimer("轨迹回放");
      pt.info("hours", Math.round((end - start) / 36e5));
      pt.info("devices", list.length);
      const res = await loadReplayData(roomId, d, start, end, list, (done, total) => setMsg({ text: `加载中… ${done}/${total}` }), pt);
      setData(res);
      setQ([start, end]);
      engine.current?.setData(res, start, end);
      pt.lap("engine");
      pt.endAfterPaint();
      const parts = [`${res.tracks.length} 个目标`, `${res.allTs.length} 个轨迹点`, `${res.marks.length} 个事件`];
      if (res.converted.length) parts.push(`已按安装方向换算坐标：${res.converted.join("、")}`);
      if (res.warnings.length) parts.push(`${res.warnings.length} 个请求失败：${res.warnings[0]}`);
      setMsg({ text: parts.join(" · "), err: res.warnings.length > 0 });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), err: true });
    } finally {
      setLoading(false);
    }
  }

  // 房间平面图，加载后自动查今天
  useEffect(() => {
    if (!roomId) return;
    getRoomDetail(roomId).then(
      (d) => {
        setDetail(d);
        engine.current?.setDetail(d);
        const has = !!sn && (d.devices ?? []).some((x) => x.sn === sn);
        const list = has ? [sn!] : (d.devices ?? []).map((x) => x.sn);
        setSns(list);
        query(undefined, d, list);
      },
      (e) => setRoomError(e instanceof Error ? e.message : String(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, sn]);

  // 快捷键：空格播放 / 暂停，←→ 1 秒（Shift 10 秒），+ / - 缩放时间轴
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable], .ant-select, .ant-picker")) return;
      const en = engine.current;
      if (!en?.data) return;
      if (e.key === " ") {
        e.preventDefault();
        en.toggle();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        en.step((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10000 : 1000));
      } else if (e.key === "+" || e.key === "=") en.zoomTimeline(0.5, en.t);
      else if (e.key === "-") en.zoomTimeline(2, en.t);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const legend = useMemo(() => {
    const used = new Set<number>();
    for (const tr of data?.tracks ?? []) for (const s of tr.postures) used.add(s.p);
    const keys = used.size ? [...used].sort((a, b) => a - b) : Object.keys(POSTURES).map(Number);
    return keys.filter((k) => POSTURES[k]);
  }, [data]);

  if (!roomId) return <Empty style={{ marginTop: 60 }} description="这台设备没有绑定房间，时间回溯按房间查询，绑定房间后才能使用" />;
  if (roomError) return <Empty style={{ marginTop: 60 }} description={`加载房间失败：${roomError}`} />;

  const devices = detail?.devices?.filter((d) => d.sn) ?? [];
  const multiDay = q[1] > q[0] && fmtDate(new Date(q[0])) !== fmtDate(new Date(q[1] - 1));
  const en = engine.current;

  return (
    <div className={`replay${dark ? " dark" : ""}${fill ? " fill" : ""}`}>
      <div className="toolbar">
        <DatePicker.RangePicker
          showTime
          value={range}
          allowClear={false}
          disabledDate={(d) => d.isAfter(dayjs(), "day")}
          onChange={(v) => v?.[0] && v[1] && setRange([v[0], v[1]])}
        />
        <div className="quick">
          {QUICK.map((x) => (
            <button
              key={x.key}
              onClick={() => {
                const r = x.range();
                setRange([dayjs(r[0]), dayjs(r[1])]);
                query(r);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        <Button type="primary" loading={loading} onClick={() => query()}>
          查询
        </Button>
      </div>
      {devices.length > 1 && (
        <div className="toolbar">
          <span className="muted small">同房间的设备</span>
          <Checkbox.Group
            value={sns}
            onChange={(v) => setSns(v as string[])}
            options={devices.map((d) => ({
              value: d.sn,
              label: (
                <span title={d.sn}>
                  {d.deviceName || d.sn}
                  {d.isOnline ? "" : <span className="muted">（离线）</span>}
                </span>
              ),
            }))}
          />
        </div>
      )}
      {msg && <div className={`rp-msg${msg.err ? " err" : ""}`}>{msg.text}</div>}

      <div className="rp-body">
        <div className="rp-stage" ref={stage}>
          <canvas ref={roomBase} />
          <canvas ref={roomDyn} />
          <div className="rp-stage-tools">
            <Tooltip title="自适应" placement="left">
              <Button size="small" icon={<CompressOutlined />} onClick={() => en?.fitRoom()} aria-label="自适应" />
            </Tooltip>
            <Tooltip title="放大" placement="left">
              <Button size="small" icon={<PlusOutlined />} onClick={() => en?.zoomRoom(1.25)} aria-label="放大" />
            </Tooltip>
            <Tooltip title="缩小" placement="left">
              <Button size="small" icon={<MinusOutlined />} onClick={() => en?.zoomRoom(1 / 1.25)} aria-label="缩小" />
            </Tooltip>
          </div>
          <div className="rp-legend">
            {legend.map((k) => (
              <span key={k}>
                <i style={{ background: POSTURES[k].color }} />
                {POSTURES[k].text}
              </span>
            ))}
          </div>
          {(!detail || (data && !data.allTs.length && !data.tracks.length)) && <div className="rp-empty">{detail ? "这段时间没有轨迹数据" : "加载房间…"}</div>}
        </div>
        <aside className="rp-side">
          <h3>当前状态</h3>
          <StatusList clock={clock} data={data} />
          <h3>
            事件 / 告警
            {data && data.marks.length > 0 && (
              <span className="muted small">
                {data.marks.filter((m) => m.alarm).length} 告警 / {data.marks.length} 条
              </span>
            )}
          </h3>
          <MarkList clock={clock} data={data} multiDay={multiDay} onGoto={(t) => en?.gotoMark(t)} />
        </aside>
      </div>

      <div className="rp-timeline">
        <div className="rp-tl-tools">
          <Button size="small" onClick={() => en?.zoomTimeline(0.5)}>
            放大
          </Button>
          <Button size="small" onClick={() => en?.zoomTimeline(2)}>
            缩小
          </Button>
          <Button size="small" onClick={() => en?.viewAll()}>
            全部
          </Button>
          <Button size="small" onClick={() => en?.fitData()}>
            适应数据
          </Button>
          <Checkbox checked={opts.follow} onChange={(e) => setOpts((o) => ({ ...o, follow: e.target.checked }))}>
            跟随播放
          </Checkbox>
          <span style={{ flex: 1 }} />
          <span className="muted small">视图跨度 {span}</span>
          <span className="muted small">滚轮缩放 · 拖动平移 · 单击定位 · 顶部细条为全局导航</span>
        </div>
        <div className="rp-tl-wrap" ref={tlWrap}>
          <canvas ref={tlBase} />
          <canvas ref={tlOver} className="overlay" />
          <div className="rp-tip" ref={tip} />
        </div>
      </div>

      <div className="rp-player">
        <Tooltip title="回到开始">
          <Button icon={<VerticalRightOutlined />} onClick={() => en?.toStart()} disabled={!data} aria-label="回到开始" />
        </Tooltip>
        <Tooltip title="上一个事件 / 告警">
          <Button icon={<StepBackwardOutlined />} onClick={() => en?.jumpMark(-1)} disabled={!data} aria-label="上一个事件" />
        </Tooltip>
        <Tooltip title="播放 / 暂停（空格）">
          <Button type="primary" icon={playing ? <PauseOutlined /> : <CaretRightOutlined />} onClick={() => en?.toggle()} disabled={!data} aria-label="播放或暂停" />
        </Tooltip>
        <Tooltip title="下一个事件 / 告警">
          <Button icon={<StepForwardOutlined />} onClick={() => en?.jumpMark(1)} disabled={!data} aria-label="下一个事件" />
        </Tooltip>
        <span className="rp-field">
          倍速
          <Select
            value={opts.speed}
            onChange={(v) => setOpts((o) => ({ ...o, speed: v }))}
            options={SPEEDS.map((s) => ({ value: s, label: `${s}x` }))}
            style={{ width: 84 }}
          />
        </span>
        <span className="rp-field">
          尾迹
          <Select
            value={opts.trail}
            onChange={(v) => setOpts((o) => ({ ...o, trail: v }))}
            options={TRAILS.map((s) => ({ value: s, label: s ? (s >= 60 ? `${s / 60} 分钟` : `${s} 秒`) : "无" }))}
            style={{ width: 96 }}
          />
        </span>
        <Checkbox checked={opts.skip} onChange={(e) => setOpts((o) => ({ ...o, skip: e.target.checked }))}>
          <Tooltip title="播放时自动跳过没有轨迹点的时段">跳过无人时段</Tooltip>
        </Checkbox>
        <Now clock={clock} data={data} />
      </div>
    </div>
  );
}

function Now({ clock, data }: { clock: Clock; data: ReplayData | null }) {
  const t = useClock(clock);
  return <span className="rp-now mono">{data ? `${fmt(t)}.${Math.floor((t % 1000) / 100)}` : "--"}</span>;
}

function StatusList({ clock, data }: { clock: Clock; data: ReplayData | null }) {
  const t = useClock(clock);
  const status =
    data?.tracks.map((tr) => {
      const s = trackStateAt(tr, t);
      return { tr, s, pdef: s?.posture != null ? POSTURES[s.posture] : undefined };
    }) ?? [];
  return (
    <div className="rp-status">
      {status.length ? (
        status.map(({ tr, s, pdef }) => (
          <div key={tr.key} className="rp-st">
            <i className="rp-dot" style={{ background: tr.color }} />
            <span className="name" title={tr.label}>
              {tr.label}
              {s && s.x != null && s.y != null && (
                <small className="mono">
                  {(s.x / 100).toFixed(2)}, {(s.y / 100).toFixed(2)} m{s.stale ? "（最近）" : ""}
                </small>
              )}
            </span>
            {pdef ? (
              <span className="rp-tag" style={{ background: pdef.color, opacity: s?.stale ? 0.6 : 1 }}>
                {pdef.text}
              </span>
            ) : (
              <span className={`rp-tag ${s ? "unknown" : "absent"}`}>{s ? "未知姿态" : "不在场"}</span>
            )}
          </div>
        ))
      ) : (
        <div className="muted small">无目标</div>
      )}
    </div>
  );
}

/** 事件列表很长：只有当前事件变化时才更新，而且只重渲染前后两行 */
function MarkList({ clock, data, multiDay, onGoto }: { clock: Clock; data: ReplayData | null; multiDay: boolean; onGoto: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // 当前 = 已经发生的最后一条（跳到事件时正好落在事件时刻，见 engine.jumpMark）
  const markIndex = useSyncExternalStore(clock.subscribe, () => (data ? lowerBound(data.marks, clock.get() + 1, (m) => m.t) - 1 : -1));
  const goto = useRef(onGoto);
  goto.current = onGoto;
  const onClick = useCallback((t: number) => goto.current(t), []);
  useEffect(() => {
    ref.current?.querySelector(".rp-mark.current")?.scrollIntoView({ block: "nearest" });
  }, [markIndex]);
  return (
    <div className="rp-marks" ref={ref}>
      {data?.marks.length ? (
        data.marks.map((m, i) => <MarkItem key={i} m={m} current={i === markIndex} multiDay={multiDay} onClick={onClick} />)
      ) : (
        <div className="muted small">无事件</div>
      )}
    </div>
  );
}

const MarkItem = memo(function MarkItem({ m, current, multiDay, onClick }: { m: Mark; current: boolean; multiDay: boolean; onClick: (t: number) => void }) {
  return (
    <button className={`rp-mark${m.alarm ? " alarm" : ""}${current ? " current" : ""}`} onClick={() => onClick(m.t)}>
      <i className="rp-dot" style={{ background: m.color }} />
      <span className="mono">{multiDay ? fmt(m.t).slice(5) : fmtTime(new Date(m.t))}</span>
      <span className="txt">{m.text}</span>
    </button>
  );
});
