import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Empty, InputNumber, Popover, Radio, Segmented, Switch, TreeSelect } from "antd";
import { CaretRightOutlined, ControlOutlined, ExclamationCircleOutlined, FullscreenOutlined, LeftOutlined, PauseOutlined, RightOutlined, SettingOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { isTauri, session, type RealtimeState, type Session } from "@radar/core";
import type { OpsAlert } from "../api/device";
import { bedName, CARE_GROUPS, durationText, useMonitorData } from "../monitor/useMonitorData";
import { buildRooms, countCells, freshCareAlerts, getSlots, inScope, isUrgent, layoutHint, layoutWall, loadSavedSlots, loadSettings, saveSettings, saveSlots, scopeTree, suggestGrid, type Cell, type PlacedRoom, type Slot, type Tier, type WallRow, type WallSettings } from "../datawall/model";
import { enterFullscreen, leaveFullscreen } from "../workspace/fullscreen";
import { useRefreshOn, type Topic } from "../workspace/dataChange";
import { useChildWebview, useOverlayOpen } from "../workspace/childWebview";
import { platformScript, platformUrl, PRELOAD_START_MS, PRELOAD_STEP_MS, type WallPageDef } from "../datawall/pages";
import type { PlatformTarget } from "../datawall/platformTargets";
import { enabledPages, useWallConfig } from "../datawall/config";
import "../datawall/wall.css";

/** 舞台按 1920×1080 设计，整体等比缩放 */
const W = 1920;
const H = 1080;
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
function Wall({
  active,
  rt,
  playing,
  screenSeconds,
  barSlot,
  onOpenRoom,
  onScreensDone,
  onUrgent,
}: {
  active: boolean;
  rt: RealtimeState;
  playing: boolean;
  /** 放不下时每屏停留 */
  screenSeconds: number;
  /** 工具栏里给看板自己的按钮留的位置 */
  barSlot: HTMLElement | null;
  onOpenRoom: (id: string) => void;
  /** 这轮的几屏都看完了，该轮到下一个魔墙页面 */
  onScreensDone: () => void;
  /** 新的紧急告警：魔墙要切回看板 */
  onUrgent: () => void;
}) {
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
  const [round, setRound] = useState(0);
  const page = Math.min(pageState, pages.length - 1);
  const flip = useCallback((d: number) => setPage((p) => (Math.min(p, pages.length - 1) + d + pages.length) % pages.length), [pages.length]);
  const onUrgentRef = useRef(onUrgent);
  onUrgentRef.current = onUrgent;
  const urgent = useMemo(() => alerts.filter((a) => isUrgent(a, now)), [alerts, now]);
  const newest = urgent[0];
  useEffect(() => {
    if (!active || !playing) return;
    const t = setTimeout(() => {
      if (page < pages.length - 1) return setPage(page + 1);
      setPage(0);
      onScreensDone();
      // 下一页没加载好时还留在看板，要接着计时
      setRound((n) => n + 1);
    }, screenSeconds * 1000);
    return () => clearTimeout(t);
  }, [active, playing, screenSeconds, page, pages.length, onScreensDone, round]);
  // 新告警：翻到它的房间所在的页
  const newestRoom = rooms.find((r) => r.cells.some((c) => c.sn === newest?.sn))?.id;
  /** 见过的最新紧急告警时间：第一次加载时已有的不算新的；最新那条过了紧急期、换成旧的一条时也不算 */
  const urgentSeen = useRef<string>(undefined);
  const alertsLoaded = !!data.alerts.loadedAt;
  useEffect(() => {
    if (alertsLoaded) {
      const at = newest?.createdAt ?? "";
      if (urgentSeen.current !== undefined && at > urgentSeen.current) onUrgentRef.current();
      if (urgentSeen.current === undefined || at > urgentSeen.current) urgentSeen.current = at;
    }
    if (!newestRoom) return;
    const i = pages.findIndex((cols) => cols.flat().some((row) => row.rooms.some((x) => x.room.id === newestRoom)));
    if (i >= 0) setPage(i);
    // 只在最新的告警变了时翻
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest?.id, newestRoom, alertsLoaded]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 设置面板关闭的时间：点墙面关面板时，同一次点击不要再打开房间 */
  const settingsClosedAt = useRef(0);
  const open = (id: string) => {
    if (settingsOpen || Date.now() - settingsClosedAt.current < 400) return;
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
    <>
      {barSlot &&
        createPortal(
          <>
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
          {hint && (
            <span className="wall-bar-hint" title={hint}>
              <ExclamationCircleOutlined /> {hint}
            </span>
          )}
          </>,
          barSlot,
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
      </div>
    </>
  );
}

/** 平台原页面：打开魔墙后在屏幕外提前加载，之后切走只是藏起来，切回来不用重新加载。浏览器调试时没有子 webview，也写不进登录信息 */
function PlatformView({ page, s, visible, onReady }: { page: Extract<WallPageDef, { kind: "platform" }>; s: Session; visible: boolean; onReady: (key: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  /** 要打开的地址：有些页面要先挑房间、长者、日期。undefined 还没挑好，null 这个机构没有可显示的 */
  const [target, setTarget] = useState<PlatformTarget | null>();
  // 只挑一次：挑的结果变了子 webview 就会重新加载。魔墙设置改停留时间等会换一个 page 对象，不能因此重挑
  const pageRef = useRef(page);
  useEffect(() => {
    let dead = false;
    const t = pageRef.current.target;
    if (typeof t !== "function") return setTarget(t);
    t()
      .then((x) => !dead && setTarget(x ?? null))
      .catch((e) => {
        console.error(`数据魔墙：${pageRef.current.title}找不到要显示的内容`, e);
        if (!dead) setTarget(null);
      });
    return () => {
      dead = true;
    };
  }, []);
  const url = useMemo(() => (target ? platformUrl(s, target.path) : undefined), [s, target]);
  const script = useMemo(() => platformScript(s, { hideChrome: page.hideChrome, report: target?.report }), [s, page.hideChrome, target?.report]);
  const overlay = useOverlayOpen(isTauri && visible);
  const { error, ready } = useChildWebview(box, `wall-${page.key}`, isTauri ? url : undefined, 0, visible && !overlay, script, page.design);
  useEffect(() => {
    if (ready) onReady(page.key);
  }, [ready, onReady, page.key]);
  return (
    <div ref={box} className="wall-platform">
      {target === null ? (
        <Empty style={{ marginTop: 80 }} description={`这个机构还没有可显示的${page.title}`} />
      ) : !isTauri ? (
        <Empty style={{ marginTop: 80 }} description={`平台页面"${page.title}"只在客户端里显示（浏览器调试时写不进平台的登录信息）`}>
          {target && <code className="wall-platform-target">{target.path}{target.report ? ` · ${target.report.memberId.slice(0, 6)} ${target.report.analysisDay}` : ""}</code>}
        </Empty>
      ) : error ? (
        <Empty style={{ marginTop: 80 }} description={`打开失败：${error}`} />
      ) : (
        !ready && <div className="wall-platform-wait">正在加载{page.title}…</div>
      )}
    </div>
  );
}

/** 数据魔墙：几个页面（datawall/pages.ts）轮播。全房间看板房间位置固定，每台雷达一格；其他页面临时显示平台原页面 */
export default function DataWallPage({ active, rt, onOpenRoom, onOpenSettings }: { active: boolean; rt: RealtimeState; onOpenRoom: (id: string) => void; onOpenSettings: () => void }) {
  const s = session.get()!;
  const config = useWallConfig();
  const pages = useMemo(() => enabledPages(config), [config]);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const [currentKey, setCurrentKey] = useState(pages[0].key);
  // 当前页在设置里被隐藏了就显示第一页
  const current = pages.find((p) => p.key === currentKey) ?? pages[0];
  const [paused, setPaused] = useState(false);
  /** 关了轮播就不在页面之间切；全房间看板放不下时自己的几屏照样翻 */
  const playing = !paused || !config.carousel;
  const [show, setShow] = useState(false);
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);
  /** 开始加载的平台页面（一个一个开始）；手动点到的马上开始。加载后一直留着，切换、放多久都不重新加载 */
  const [opened, setOpened] = useState<string[]>([]);
  const open = useCallback((key: string) => setOpened((x) => (x.includes(key) ? x : [...x, key])), []);
  const platformKeys = pages.flatMap((p) => (p.kind === "platform" ? [p.key] : [])).join(",");
  const everActive = useRef(false);
  if (active) everActive.current = true;
  const wasEverActive = everActive.current;
  useEffect(() => {
    if (!wasEverActive) return;
    const timers = platformKeys
      .split(",")
      .filter(Boolean)
      .map((key, i) => setTimeout(() => open(key), PRELOAD_START_MS + i * PRELOAD_STEP_MS));
    return () => timers.forEach(clearTimeout);
  }, [wasEverActive, platformKeys, open]);
  // 设置里隐藏的页面关掉子 webview，不占内存；再打开时重新加载
  useEffect(() => {
    const keep = (x: string[]) => {
      const left = x.filter((k) => platformKeys.split(",").includes(k));
      return left.length === x.length ? x : left;
    };
    setOpened(keep);
    setReady(keep);
  }, [platformKeys]);
  useEffect(() => {
    if (active && current.kind === "platform") open(current.key);
  }, [active, current.kind, current.key, open]);
  /** 加载好的平台页面。没加载好的轮播时跳过，不让大屏白屏 */
  const [ready, setReady] = useState<string[]>([]);
  const onReady = useCallback((key: string) => setReady((x) => (x.includes(key) ? x : [...x, key])), []);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  /** 下一个能显示的页面（d = -1 是上一个） */
  const step = useCallback(
    (d: number) =>
      setCurrentKey((key) => {
        const list = pagesRef.current;
        const i = Math.max(0, list.findIndex((p) => p.key === key));
        for (let n = 1; n <= list.length; n++) {
          const p = list[(i + d * n + list.length * n) % list.length];
          if (p.kind === "rooms" || !isTauri || readyRef.current.includes(p.key)) return p.key;
        }
        return key;
      }),
    [],
  );
  const next = useCallback(() => step(1), [step]);
  const carouselRef = useRef(config.carousel);
  carouselRef.current = config.carousel;
  const onScreensDone = useCallback(() => {
    if (carouselRef.current) step(1);
  }, [step]);
  const toRooms = useCallback(() => setCurrentKey("rooms"), []);
  const [round, setRound] = useState(0);
  // 平台页面的停留；全房间看板翻完自己的几屏再轮到下一个（onScreensDone）
  useEffect(() => {
    if (!active || !config.carousel || paused || current.kind === "rooms") return;
    const t = setTimeout(() => {
      next();
      // 别的页面都没加载好时还留在这一页，要接着计时
      setRound((n) => n + 1);
    }, current.seconds * 1000);
    return () => clearTimeout(t);
  }, [active, config.carousel, paused, current.kind, current.key, current.seconds, next, round]);

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
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") step(-1);
    };
    // 浏览器调试时 Esc 由浏览器先退出网页全屏
    const onFs = () => !document.fullscreenElement && !isTauri && setShow(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [show, endShow, next, step]);
  // 关标签、切机构时恢复窗口
  useEffect(() => () => void leaveFullscreen().catch(() => {}), []);

  // 清掉上一版运营展示墙留在本机的缓存
  useEffect(() => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("ops.dataWall.nights.") || k === "ops.dataWall.range") localStorage.removeItem(k);
    } catch {
      /* 清不掉也不影响 */
    }
  }, []);
  const rooms = pages.find((p) => p.kind === "rooms");
  return (
    <div className={show ? "wall-show" : "wall-page"}>
      {!show && (
        <div className="wall-bar">
          {pages.length > 1 && <Segmented size="small" value={current.key} onChange={(k) => setCurrentKey(k as string)} options={pages.map((p) => ({ value: p.key, label: p.title }))} />}
          {config.carousel && pages.length > 1 && (
            <Button size="small" icon={paused ? <CaretRightOutlined /> : <PauseOutlined />} onClick={() => setPaused((x) => !x)}>
              {paused ? "继续轮播" : "暂停轮播"}
            </Button>
          )}
          <Button size="small" icon={<ControlOutlined />} onClick={onOpenSettings}>
            魔墙设置
          </Button>
          <Button size="small" type="primary" icon={<FullscreenOutlined />} onClick={startShow}>
            全屏放映
          </Button>
          <span className="wall-bar-sep" />
          <span ref={setBarSlot} className="wall-bar-slot" hidden={current.kind !== "rooms"} />
        </div>
      )}
      {/* 放映时也能切页面。子 webview 盖在网页上面，按钮不能放在它上面，所以留一条；焦点在平台页面里时键盘也收不到 */}
      {show && (
        <div className="wall-show-strip">
          <span className="wall-show-tabs">
            {pages.map((p) => (
              <button key={p.key} className={p.key === current.key ? "on" : undefined} onClick={() => setCurrentKey(p.key)}>
                {p.title}
              </button>
            ))}
          </span>
          <button onClick={endShow} title="退出放映（Esc）">
            退出放映
          </button>
        </div>
      )}
      <div className="wall-views">
        {/* 全房间看板隐藏后不挂载：不订阅推送、不取告警 */}
        {rooms && (
          <div className="wall-view" hidden={current.kind !== "rooms"}>
            <Wall
              active={active}
              rt={rt}
              playing={playing && current.kind === "rooms"}
              screenSeconds={rooms.seconds}
              barSlot={barSlot}
              onOpenRoom={(id) => {
                endShow();
                onOpenRoom(id);
              }}
              onScreensDone={onScreensDone}
              onUrgent={toRooms}
            />
          </div>
        )}
        {pages.flatMap((p) =>
          p.kind === "platform" && opened.includes(p.key)
            ? [
                <div key={p.key} className={`wall-view-platform${current.key === p.key ? "" : " off"}`}>
                  <PlatformView page={p} s={s} visible={active && current.key === p.key} onReady={onReady} />
                </div>,
              ]
            : [],
        )}
      </div>
    </div>
  );
}
