import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button, InputNumber, Popover, Radio, Segmented, Switch, TreeSelect } from "antd";
import { ExclamationCircleOutlined, FullscreenOutlined, LeftOutlined, RightOutlined, SettingOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { isTauri, session, type RealtimeState } from "@radar/core";
import type { OpsAlert } from "../api/device";
import { bedName, CARE_GROUPS, durationText, useMonitorData } from "../monitor/useMonitorData";
import { buildRooms, countCells, freshCareAlerts, getSlots, inScope, isUrgent, layoutHint, layoutWall, loadSavedSlots, loadSettings, saveSettings, saveSlots, scopeTree, suggestGrid, type Cell, type PlacedRoom, type Slot, type Tier, type WallRow, type WallSettings } from "../datawall/model";
import { enterFullscreen, leaveFullscreen } from "../workspace/fullscreen";
import { useRefreshOn, type Topic } from "../workspace/dataChange";
import "../datawall/wall.css";

/** 舞台按 1920×1080 设计，整体等比缩放 */
const W = 1920;
const H = 1080;
/** 放不下时每页停留 */
const PAGE_MS = 20_000;
/** 长期开着时重取房间、雷达、长者的间隔（状态靠推送） */
const RELOAD_MS = 10 * 60_000;
const NAMES_KEY = "ops.dataWall.names";
const REFRESH_ON: Topic[] = ["device", "space", "member"];
/** 自动滚动的速度（舞台像素 / 秒） */
const SCROLL_SPEED = 30;
const noAlerts = () => {};
const NO_SLOTS = new Map<string, Slot>();

const loadNames = () => {
  try {
    return localStorage.getItem(NAMES_KEY) === "1";
  } catch {
    return false;
  }
};

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

function BedCell({ c, tier }: { c: Cell; tier: Tier }) {
  const vitals = c.heartRate !== undefined || c.respiratoryRate !== undefined;
  // 圆点按这个人实测的呼吸频率起伏
  const breath = (c.tone === "sleep" || c.tone === "awake") && c.respiratoryRate ? `${(60 / c.respiratoryRate).toFixed(1)}s` : undefined;
  return (
    <div className={`wc wc-${c.tone}${c.longOut ? " wc-long" : ""}${c.label ? "" : " wc-solo"}${vitals && !c.issue ? " wc-has-vitals" : ""}${c.issue ? " wc-has-issue" : ""}`} style={{ width: tier.w, height: tier.h }} title={`${c.label ? `${c.label}：` : ""}${c.state}${c.issue ? `，${c.issue}` : ""}${c.pending ? `，${c.pending}未处理` : ""}`}>
      {(c.label || c.pending || c.bed) && (
        <div className="wc-top">
          <span className="wc-label">{c.label}</span>
          {c.pending && <span className="wc-pend">未处理</span>}
          {c.bed && <i className="wc-dot" style={breath ? { animationName: "wall-breath", animationDuration: breath } : undefined} />}
        </div>
      )}
      {/* 呼吸暂停、体征弱比睡眠状态要紧，有就写它 */}
      <div className={`wc-state${c.issue ? " wc-warn" : ""}`}>{c.issue ?? c.state}</div>
      {vitals && (
        <div className="wc-vitals">
          <span>
            {c.heartRate ?? "—"}
            <small>心率</small>
          </span>
          <span>
            {c.respiratoryRate ?? "—"}
            <small>呼吸</small>
          </span>
        </div>
      )}
    </div>
  );
}

function RoomBlock({ place, tier: pageTier, onOpen }: { place: PlacedRoom; tier: Tier; onOpen: (id: string) => void }) {
  const { room, cols, width, height, title } = place;
  const tier = place.tier ?? pageTier;
  // 手动行列的房间格子一样大，床位格子的大小、字号每个房间各算各的
  const own = place.tier ? ({ "--u": `${tier.u}px`, height } as CSSProperties) : undefined;
  return (
    <section className={`wr${room.alert ? " wr-alert" : ""}${place.tier ? ` t-${tier.name}` : ""}`} style={{ width, ...own }} onClick={() => onOpen(room.id)} title="打开实时监控">
      <header style={{ height: tier.head }}>{title ?? room.name}</header>
      <div className="wr-cells" style={{ gridTemplateColumns: `repeat(${cols}, ${tier.w}px)`, gridAutoRows: tier.h }}>
        {room.cells.map((c) => (
          <BedCell key={c.sn} c={c} tier={tier} />
        ))}
      </div>
    </section>
  );
}

/** 显示设置：范围、排版、放不下时 */
function SettingsForm({ v, tree, roomCount, hint, onChange }: { v: WallSettings; tree: ReturnType<typeof scopeTree>; roomCount: number; hint?: string; onChange: (v: WallSettings) => void }) {
  return (
    <div className="wall-set">
      <label>显示范围</label>
      <TreeSelect
        size="small"
        treeCheckable
        treeDefaultExpandAll
        showCheckedStrategy={TreeSelect.SHOW_PARENT}
        placeholder="全部楼栋、楼层"
        maxTagCount="responsive"
        value={v.scope}
        treeData={tree}
        onChange={(scope: string[]) => onChange({ ...v, scope })}
        getPopupContainer={(n) => n.parentElement!}
      />
      <label>排版</label>
      <Segmented
        size="small"
        value={v.mode}
        onChange={(mode) => onChange({ ...v, ...(v.rows && v.cols ? undefined : suggestGrid(roomCount)), mode: mode as WallSettings["mode"] })}
        options={[
          { value: "auto", label: "自动" },
          { value: "grid", label: "手动行列" },
        ]}
      />
      {v.mode === "grid" && (
        <>
          <label>一屏</label>
          <span className="wall-set-grid">
            <InputNumber size="small" min={1} max={20} value={v.rows} onChange={(rows) => rows && onChange({ ...v, rows })} /> 行
            <InputNumber size="small" min={1} max={20} value={v.cols} onChange={(cols) => cols && onChange({ ...v, cols })} /> 列房间
          </span>
        </>
      )}
      <label>放不下时</label>
      <Radio.Group size="small" value={v.overflow} onChange={(e) => onChange({ ...v, overflow: e.target.value })}>
        <Radio value="page">翻屏轮播</Radio>
        <Radio value="scroll">自动滚动</Radio>
        <Radio value="shrink">整屏缩小</Radio>
      </Radio.Group>
      {hint && <div className="wall-set-hint">{hint}</div>}
    </div>
  );
}

/** 内容比屏幕高时上下来回滚动（大屏没人操作）；两头各停一下 */
function Scroller({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [extra, setExtra] = useState(0);
  useLayoutEffect(() => {
    if (!enabled) return setExtra(0);
    const measure = () => setExtra(Math.max(0, inner.current!.offsetHeight - outer.current!.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer.current!);
    ro.observe(inner.current!);
    return () => ro.disconnect();
  }, [enabled]);
  const style = extra > 0 ? ({ "--scroll": `-${extra}px`, animationDuration: `${Math.max(6, extra / SCROLL_SPEED / 0.8)}s` } as CSSProperties) : undefined;
  return (
    <div ref={outer} className="wall-scroller">
      <div ref={inner} className={extra > 0 ? "wall-scrolling" : undefined} style={style}>
        {children}
      </div>
    </div>
  );
}

const alertPlace = (a: OpsAlert) => [a.floorName, a.roomName, a.deviceName && a.sn ? bedName(a.deviceName, a.roomName ?? "", a.sn) : undefined].filter((x, i, xs) => x && xs.indexOf(x) === i).join(" ");

/**
 * 看板本身：标签开着就一直挂着、一直订阅推送，隐藏时（切标签、进实时监控）只是不刷界面，
 * 这样切回来马上是最新的，不用重新等设备推送。关掉标签才断开
 */
function Wall({ active, rt, onOpenRoom }: { active: boolean; rt: RealtimeState; onOpenRoom: (id: string) => void }) {
  const s = session.get()!;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  /** 实时连接连上的时间（断开后重新计） */
  const [listeningSince, setListeningSince] = useState<number>();
  useEffect(() => setListeningSince(rt === "connected" ? Date.now() : undefined), [rt]);

  const data = useMonitorData(now, noAlerts, !active);
  const [slots, setSlots] = useState<Map<string, Slot> | undefined>(() => loadSavedSlots(s.orgId));
  const loadSlots = useCallback(
    () =>
      getSlots()
        .then((x) => {
          setSlots(x);
          saveSlots(s.orgId, x);
        })
        .catch((e) => console.error("数据魔墙：加载长者列表失败", e)),
    [s.orgId],
  );
  const { reload } = data;
  const refresh = useCallback(() => {
    reload();
    loadSlots();
  }, [reload, loadSlots]);
  useRefreshOn(REFRESH_ON, refresh);
  useEffect(() => {
    loadSlots();
    const t = setInterval(refresh, RELOAD_MS);
    return () => clearInterval(t);
  }, [loadSlots, refresh]);

  const [showName, setShowName] = useState(loadNames);
  const pickNames = (v: boolean) => {
    setShowName(v);
    try {
      localStorage.setItem(NAMES_KEY, v ? "1" : "0");
    } catch {
      /* 只是记住选择 */
    }
  };

  const [settings, setSettings] = useState(() => loadSettings(s.orgId));
  const pickSettings = (v: WallSettings) => {
    setSettings(v);
    saveSettings(s.orgId, v);
  };
  const { scope } = settings;

  const allAlerts = useMemo(() => freshCareAlerts(data.alerts.pending, now), [data.alerts.pending, now]);
  const allRooms = useMemo(() => buildRooms(data.tiles, data.live, data.links, slots ?? NO_SLOTS, allAlerts, { now, listeningSince: slots ? listeningSince : undefined, showName, slotsKnown: !!slots }), [data.tiles, data.live, data.links, slots, allAlerts, now, listeningSince, showName]);
  const tree = useMemo(() => scopeTree(allRooms), [allRooms]);
  // 显示范围：墙上、总数、横幅都只看范围内的，范围外还有多少告警写在页脚
  const rooms = useMemo(() => allRooms.filter((r) => inScope(scope, r.floorKey)), [allRooms, scope]);
  const alerts = useMemo(() => allAlerts.filter((a) => inScope(scope, `${a.buildingName ?? ""}|${a.floorName ?? ""}`)), [allAlerts, scope]);
  const n = countCells(rooms);
  const layout = layoutWall(rooms, settings);
  const { tier, pages } = layout;
  const hint = rooms.length ? layoutHint(layout) : undefined;

  const [pageState, setPage] = useState(0);
  const page = Math.min(pageState, pages.length - 1);
  const flip = useCallback((d: number) => setPage((p) => (Math.min(p, pages.length - 1) + d + pages.length) % pages.length), [pages.length]);
  const urgent = useMemo(() => alerts.filter((a) => isUrgent(a, now)), [alerts, now]);
  const newest = urgent[0];
  useEffect(() => {
    if (!active || pages.length < 2) return;
    const t = setTimeout(() => flip(1), PAGE_MS);
    return () => clearTimeout(t);
  }, [active, page, pages.length, flip]);
  // 新告警：翻到它的房间所在的页
  const newestRoom = rooms.find((r) => r.cells.some((c) => c.sn === newest?.sn))?.id;
  useEffect(() => {
    if (!newestRoom) return;
    const i = pages.findIndex((cols) => cols.flat().some((row) => row.rooms.some((x) => x.room.id === newestRoom)));
    if (i >= 0) setPage(i);
    // 只在最新的告警变了时翻
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest?.id, newestRoom]);

  const [show, setShow] = useState(false);
  async function startShow() {
    setShow(true);
    await enterFullscreen().catch(() => {});
  }
  const endShow = useCallback(async () => {
    setShow(false);
    await leaveFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endShow();
      else if (e.key === "ArrowRight") flip(1);
      else if (e.key === "ArrowLeft") flip(-1);
    };
    // 浏览器调试时 Esc 由浏览器先退出网页全屏
    const onFs = () => !document.fullscreenElement && !isTauri && setShow(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [show, endShow, flip]);
  // 关标签、切机构时恢复窗口
  useEffect(() => () => void leaveFullscreen().catch(() => {}), []);

  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 设置面板关闭的时间：点墙面关面板时，同一次点击不要再打开房间 */
  const settingsClosedAt = useRef(0);
  const open = (id: string) => {
    if (settingsOpen || Date.now() - settingsClosedAt.current < 400) return;
    endShow();
    onOpenRoom(id);
  };
  const older = data.alerts.pending.filter((a) => CARE_GROUPS.has(a.alertTypeGroup ?? 0)).length - allAlerts.length;
  const outside = allAlerts.length - alerts.length;

  const column = (rows: WallRow[]) =>
    rows.map((row, i) => (
      <div key={i} className={`wall-row${row.floor !== undefined && i ? " wall-row-floor" : ""}`}>
        {!layout.grid && (
          <div className="wall-floor">
            {row.floor}
            {row.building && <small title={row.building}>{row.building}</small>}
          </div>
        )}
        <div className="wall-rooms">
          {row.rooms.map((x) => (
            <RoomBlock key={x.room.id} place={x} tier={tier} onOpen={open} />
          ))}
        </div>
      </div>
    ));

  return (
    <div className={show ? "wall-show" : "wall-page"}>
      {!show && (
        <div className="wall-bar">
          <Switch size="small" checked={showName} onChange={pickNames} />
          <span>显示长者姓氏</span>
          {pages.length > 1 && (
            <>
              <span className="wall-bar-sep" />
              <Button size="small" icon={<LeftOutlined />} onClick={() => flip(-1)} />
              <span>
                {page + 1} / {pages.length}
              </span>
              <Button size="small" icon={<RightOutlined />} onClick={() => flip(1)} />
            </>
          )}
          <span className="wall-bar-sep" />
          <Popover
            trigger="click"
            placement="bottomLeft"
            title="显示设置"
            open={settingsOpen}
            onOpenChange={(v) => {
              setSettingsOpen(v);
              if (!v) settingsClosedAt.current = Date.now();
            }}
            content={<SettingsForm v={settings} tree={tree} roomCount={rooms.length} hint={hint} onChange={pickSettings} />}
          >
            <Button size="small" icon={<SettingOutlined />}>
              显示设置
            </Button>
          </Popover>
          <Button size="small" type="primary" icon={<FullscreenOutlined />} onClick={startShow}>
            全屏放映
          </Button>
          {hint && (
            <span className="wall-bar-hint" title={hint}>
              <ExclamationCircleOutlined /> {hint}
            </span>
          )}
        </div>
      )}
      <div className="wall">
        <Stage>
          <header className="wall-head">
            <div className="wall-org">
              <b>{s.orgName}</b>
              <span>{scope.length ? "部分楼层实时" : "全院实时"}{pages.length > 1 ? ` · 第 ${page + 1} / ${pages.length} 屏` : ""}</span>
            </div>
            {newest ? (
              <button className="wall-banner" onClick={() => newestRoom && open(newestRoom)}>
                <b>{newest.alertTypeName}</b>
                <span>{alertPlace(newest)}</span>
                <span>已 {durationText(now - Date.parse(newest.createdAt.replace(" ", "T")))}</span>
                {urgent.length > 1 && <span className="wall-banner-more">共 {urgent.length} 条紧急</span>}
              </button>
            ) : (
              <div className="wall-kpi-ok">{rt === "connected" && !alerts.length ? "当前没有待处理告警" : ""}</div>
            )}
            <div className="wall-clock">
              <b>{dayjs(now).format("HH:mm:ss")}</b>
              <span>
                {dayjs(now).format("YYYY年M月D日")} 星期{"日一二三四五六"[dayjs(now).day()]}
              </span>
            </div>
          </header>
          <div className="wall-kpis">
            <div>
              <b>{n.sleep + n.awake}</b>在床
            </div>
            <div className="sleep">
              <b>{n.sleep}</b>睡着
            </div>
            <div className="awake">
              <b>{n.awake}</b>在床醒着
            </div>
            <div className="out">
              <b>{n.out}</b>不在床
            </div>
            <div className="busy">
              <b>{n.busy}</b>有人
            </div>
            <div className="empty">
              <b>{n.empty}</b>无人
            </div>
            <div className="none">
              <b>{n.none}</b>离线
            </div>
            <div className={urgent.length ? "alert" : alerts.length ? "out" : undefined}>
              <b>{alerts.length}</b>待处理告警
            </div>
          </div>
          <main className={`wall-body t-${tier.name}`} key={page} style={{ "--u": `${tier.u}px` } as CSSProperties}>
            {data.error ? <div className="wall-empty">取数失败：{data.error}</div> : data.loading && !rooms.length ? <div className="wall-empty">正在取数…</div> : rooms.length ? (
              <Scroller enabled={!!layout.scroll}>
                <div className="wall-columns" style={layout.scale ? { width: `${100 / layout.scale}%`, transform: `scale(${layout.scale})`, transformOrigin: "0 0" } : undefined}>
                  {pages[page].map((rows, i) => (
                    <div key={i} className="wall-column">
                      {column(rows)}
                    </div>
                  ))}
                </div>
              </Scroller>
            ) : <div className="wall-empty">{scope.length && allRooms.length ? "所选范围里没有绑定雷达的房间" : "这个机构还没有绑定雷达的房间"}</div>}
          </main>
          <footer className="wall-foot">
            <span>{rt === "connected" ? "实时连接正常" : <em>实时连接中断，屏上内容可能不是最新</em>}</span>
            <span>
              {rooms.length} 间房 · {rooms.reduce((x, r) => x + r.cells.length, 0)} 台雷达
              {outside > 0 ? ` · 范围外 ${outside} 条待处理` : ""}
              {older > 0 ? ` · 另有 ${older} 条超过 24 小时未处理` : ""}
            </span>
          </footer>
        </Stage>
        {show && (
          <button className="wall-exit" onClick={endShow} title="退出放映（Esc）">
            退出放映
          </button>
        )}
      </div>
    </div>
  );
}

/** 数据魔墙：全房间实时看板。房间位置固定，每台雷达一格：床位显示睡眠和心率呼吸，其他显示有人无人 */
export default function DataWallPage({ active, rt, onOpenRoom }: { active: boolean; rt: RealtimeState; onOpenRoom: (id: string) => void }) {
  // 清掉上一版运营展示墙留在本机的缓存
  useEffect(() => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("ops.dataWall.nights.") || k === "ops.dataWall.range") localStorage.removeItem(k);
    } catch {
      /* 清不掉也不影响 */
    }
  }, []);
  return <Wall active={active} rt={rt} onOpenRoom={onOpenRoom} />;
}
