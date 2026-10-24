import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, ConfigProvider, Dropdown, Form, Input, Modal, Select, theme as antdTheme } from "antd";
import { BgColorsOutlined, CheckOutlined, CompressOutlined, ExpandOutlined } from "@ant-design/icons";
import { baseTheme, isTauri, POSTURE, WindowControls, type LiveData, type RealtimeState, type Session } from "@radar/core";
import { getProcessTypes, processAlert, type OpsAlert } from "../api/device";
import { getRoomDesign, radarElements, roomSize, type RoomDesign } from "../api/room";
import RoomPlan, { type PlanRadar } from "../rooms/RoomPlan";
import { facingOf, MODE, modeOf, MOUNT, mountOf, radarInRoom, zoneRect, zonesOf, type QlConfig } from "../rooms/qinglan";
import ReplayView from "../devices/replay/ReplayView";
import { STATE_TEXT } from "../pages/RealtimePage";
import { bedName, bedVitals, CARE_GROUPS, durationText, hasVitals, useMonitorData, type BedVitals, type RoomKind, type RoomTile } from "./useMonitorData";
import { useLiveTargets, type LiveTarget } from "./useLiveTargets";
import { replayPalette, saveScheme, savedScheme, SCHEMES, schemeCss, type Scheme } from "./schemes";
import "./monitor.css";

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** antd 主题跟着配色方案（弹窗、下拉、输入框） */
const themeOf = (sc: Scheme) => ({
  ...baseTheme,
  algorithm: sc.tone === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  token: { ...baseTheme.token, colorBgElevated: sc.tone === "dark" ? sc.c.card : "#FFFFFF", colorBgContainer: sc.c.panel, colorBorder: sc.c.border2, colorPrimary: sc.c.accent },
});

/**
 * 实时目标（雷达坐标，cm）→ 房间平面图坐标。
 * 与回放的 radarToRoom 同一套换算，但实时数据的 y 轴不用取反（见 docs/site-analysis.md：侧装朝右时实时 (x, y) 对应 (radar.x − y, radar.y − x)）。
 */
function liveToRoom(c: QlConfig, x: number, y: number): [number, number] {
  const { x: cx, y: cy } = radarInRoom(c);
  const dir = facingOf(c);
  if (mountOf(c) === 0) {
    if (dir === 1) return [cx + x, cy - y];
    if (dir === 3) return [cx - x, cy + y];
    if (dir === 2) return [cx + y, cy + x];
    return [cx - y, cy - x];
  }
  if (dir === 1) return [cx - x, cy + y];
  if (dir === 3) return [cx + x, cy - y];
  if (dir === 2) return [cx - y, cy - x];
  return [cx + y, cy + x];
}

const currentWindow = () => import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());
/** 进全屏前窗口是不是最大化的，退出全屏时还原 */
let wasMaximized = false;

/**
 * 全屏。Windows 上无边框窗口有两个坑，都会让网页区域比屏幕矮、底下露出一条底色：
 * 1. 最大化状态下直接全屏，网页还停在最大化时的高度（屏幕减任务栏），所以先取消最大化；
 * 2. 窗口带阴影时也会少一截，全屏期间关掉阴影。
 */
async function enterFullscreen() {
  const w = await currentWindow();
  wasMaximized = await w.isMaximized();
  if (wasMaximized) await w.unmaximize();
  await w.setShadow(false);
  await w.setFullscreen(true);
}

async function leaveFullscreen() {
  const w = await currentWindow();
  if (!(await w.isFullscreen())) return;
  await w.setFullscreen(false);
  await w.setShadow(true);
  if (wasMaximized) await w.maximize();
  wasMaximized = false;
}

/** 告警卡片的级别：未处理的护理告警红，未处理的离线 / 安装姿态橙，已处理的灰 */
function alertLevel(a: OpsAlert) {
  if (a.alertStatus !== 1) return "done";
  return CARE_GROUPS.has(a.alertTypeGroup ?? 0) ? "high" : "mid";
}

const KIND_LABEL: Record<RoomKind, string> = { alert: "告警", busy: "有人", empty: "无人", offline: "离线", none: "未绑定" };

/**
 * 监控模式：值守时全屏开着的深色界面（设计稿"监控模式"画板）。
 * 左边房间卡片（告警优先 · 有人 · 无人 · 离线），中间选中房间的平面图和实时目标，右边今天的告警流。
 */
export default function MonitorMode({ s, rt, onExit }: { s: Session; rt: RealtimeState; onExit: (to?: "alerts") => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /** 新来的护理告警：自动切到它的房间 */
  const follow = useRef<string | undefined>(undefined);
  const onNewAlerts = useCallback((fresh: OpsAlert[]) => {
    const care = fresh.find((a) => CARE_GROUPS.has(a.alertTypeGroup ?? 0));
    if (care) follow.current = care.id;
  }, []);
  const data = useMonitorData(now, onNewAlerts);
  const { tiles, stats, alerts, live } = data;

  const [selId, setSelId] = useState<string>();
  useEffect(() => {
    if (follow.current) {
      const t = tiles.find((x) => x.alert?.id === follow.current);
      if (t) {
        follow.current = undefined;
        setSelId(t.room.id);
        return;
      }
    }
    if (tiles.length && (!selId || !tiles.some((t) => t.room.id === selId))) setSelId(tiles[0].room.id);
    // tiles 已按告警 / 有人 / 无人 / 离线 / 未绑定排好，第一个就是最该看的
  }, [tiles, selId]);
  const sel = tiles.find((t) => t.room.id === selId);
  /** 没绑雷达的房间默认不显示（测试机构大半房间没有设备，混在里面很吵） */
  const [showUnbound, setShowUnbound] = useState(false);
  const unbound = tiles.filter((t) => t.kind === "none").length;
  const shownTiles = showUnbound ? tiles : tiles.filter((t) => t.kind !== "none");

  const [processing, setProcessing] = useState<OpsAlert | null>(null);
  const [replay, setReplay] = useState<{ roomId?: string; sn?: string; title?: string } | null>(null);

  const [fullscreen, setFullscreen] = useState(false);
  async function toggleFullscreen() {
    const next = !(await currentWindow().then((w) => w.isFullscreen()));
    await (next ? enterFullscreen() : leaveFullscreen());
    setFullscreen(next);
  }
  // 退出监控时恢复窗口
  useEffect(
    () => () => {
      if (isTauri) leaveFullscreen().catch(() => {});
    },
    [],
  );

  const st = STATE_TEXT[rt];
  const stale = rt !== "connected";

  const [scheme, setScheme] = useState(savedScheme);
  const theme = useMemo(() => themeOf(scheme), [scheme]);
  const pick = (k: string) => {
    const sc = SCHEMES.find((x) => x.key === k);
    if (!sc) return;
    setScheme(sc);
    saveScheme(sc.key);
  };

  return (
    <ConfigProvider theme={theme}>
      <style>{schemeCss(scheme)}</style>
      <div className="monitor" data-scheme={scheme.key}>
        <header className="mon-head" data-tauri-drag-region>
          <div className="mon-brand" data-tauri-drag-region>
            <img src="/logo.svg" alt="" width={22} height={22} />
            <span>Radar Config</span>
            <span className="mon-pill">监控模式</span>
          </div>
          <span className="mon-org" data-tauri-drag-region>
            {s.orgName}
          </span>
          <span className="mon-spacer" data-tauri-drag-region />
          <span className="mon-clock">{clock(now)}</span>
          <span className={`mon-live${stale ? " bad" : ""}`} title="SignalR /hub/message">
            <i style={{ background: st.dot }} />
            实时{st.text}
          </span>
          <Dropdown
            trigger={["click"]}
            menu={{
              selectedKeys: [scheme.key],
              onClick: ({ key }) => pick(key),
              items: SCHEMES.map((x) => ({
                key: x.key,
                label: (
                  <span title={x.desc}>
                    <span className="mon-swatch" aria-hidden="true">
                      {[x.c.bg, x.c.card, x.c.accent, x.c.alert].map((c, i) => (
                        <i key={i} style={{ background: c }} />
                      ))}
                    </span>
                    {x.name}
                    {x.key === scheme.key && <CheckOutlined style={{ marginLeft: 10 }} />}
                  </span>
                ),
              })),
            }}
          >
            <button className="mon-btn" title="配色" aria-label="配色">
              <BgColorsOutlined />
              {scheme.name}
            </button>
          </Dropdown>
          {isTauri && (
            <button className="mon-btn" onClick={toggleFullscreen} title={fullscreen ? "退出全屏" : "全屏"}>
              {fullscreen ? <CompressOutlined /> : <ExpandOutlined />}
            </button>
          )}
          <button className="mon-btn" onClick={() => onExit()}>
            退出监控
          </button>
          <WindowControls className="mon-win" />
        </header>
        {stale && <div className="mon-stale">实时推送{st.text}，房间状态和目标位置可能停在断开前，告警仍每分钟刷新一次</div>}

        <div className="mon-kpis">
          <Kpi label="在线设备" value={stats.online} total={stats.devices} tone="ok" />
          <Kpi label="有人房间" value={stats.busyRooms} total={stats.rooms} />
          <Kpi label="未处理告警" value={alerts.pendingTotal} tone={alerts.pendingTotal ? "alert" : undefined} />
          <Kpi label="今日告警" value={alerts.todayTotal} />
        </div>

        <div className="mon-body">
          <section className="mon-rooms" aria-label="房间">
            <div className="mon-sec-head">
              <h2>房间</h2>
              {unbound > 0 ? (
                <button className="mon-link" onClick={() => setShowUnbound((v) => !v)}>
                  {showUnbound ? "隐藏" : "显示"}未绑定设备的房间（{unbound}）
                </button>
              ) : (
                <span>告警优先 · 有人 · 无人 · 离线</span>
              )}
            </div>
            {data.error ? (
              <div className="mon-empty">
                加载房间失败：{data.error}
                <button className="mon-btn" onClick={data.reload}>
                  重试
                </button>
              </div>
            ) : data.loading && !tiles.length ? (
              <div className="mon-empty">加载中…</div>
            ) : !shownTiles.length ? (
              <div className="mon-empty">{tiles.length ? "没有绑定雷达的房间" : "这个机构还没有房间"}</div>
            ) : (
              <div className="mon-room-grid">
                {shownTiles.map((t) => (
                  <button key={t.room.id} className={`mon-room ${t.kind}${t.room.id === selId ? " sel" : ""}`} onClick={() => setSelId(t.room.id)} title={KIND_LABEL[t.kind]}>
                    <span className="mon-room-top">
                      <span className="mon-room-name">{t.room.roomName}</span>
                      <i className="mon-dot" />
                    </span>
                    <span className="mon-room-state">{t.state}</span>
                    {t.flag ? <span className="mon-room-meta flag">{t.flag}</span> : <span className="mon-room-meta">{t.meta}</span>}
                  </button>
                ))}
              </div>
            )}
          </section>

          {sel ? (
            <RoomLive
              tile={sel}
              live={live}
              now={now}
              onProcess={setProcessing}
              onReplay={(sn) => setReplay({ roomId: sel.room.id, sn, title: sel.room.roomName })}
            />
          ) : (
            <section className="mon-live-room mon-empty">选一个房间查看实时情况</section>
          )}

          <section className="mon-alerts" aria-label="告警流">
            <div className="mon-sec-head">
              <h2>告警流</h2>
              <button className="mon-link" onClick={() => onExit("alerts")}>
                全部告警
              </button>
            </div>
            {!alerts.loadedAt ? (
              <div className="mon-empty">加载中…</div>
            ) : !alerts.stream.length ? (
              <div className="mon-empty">今天还没有告警</div>
            ) : (
              <div className="mon-alert-list">
                {alerts.stream.slice(0, 80).map((a) => (
                  <AlertCard
                    key={a.id}
                    a={a}
                    onSelect={() => {
                      const t = tiles.find((x) => x.devices.some((d) => d.sn === a.sn) || (x.room.roomName === a.roomName && x.room.floorName === a.floorName));
                      if (t) setSelId(t.room.id);
                    }}
                    onProcess={() => setProcessing(a)}
                    onReplay={
                      a.sn
                        ? () => {
                            const t = tiles.find((x) => x.devices.some((d) => d.sn === a.sn));
                            setReplay({ roomId: t?.room.id, sn: a.sn!, title: t?.room.roomName ?? a.roomName });
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <ProcessDialog alert={processing} onClose={() => setProcessing(null)} onDone={alerts.reload} />

        <Modal
          open={!!replay}
          title={replay?.title ? `时间回溯 · ${replay.title}` : "时间回溯"}
          footer={null}
          width="94vw"
          rootClassName="mon-modal"
          destroyOnHidden
          centered
          onCancel={() => setReplay(null)}
          styles={{ body: { height: "82vh", display: "flex", flexDirection: "column", overflow: "auto" } }}
        >
          {replay && <ReplayView roomId={replay.roomId} sn={replay.sn} dark={scheme.tone === "dark"} palette={replayPalette(scheme)} fill />}
        </Modal>
      </div>
    </ConfigProvider>
  );
}

/** 监控平面图是否画雷达区域：每台电脑自己记住，换房间、下次打开都沿用 */
const ZONES_KEY = "RC_MONITOR_ZONES";
function savedShowZones() {
  try {
    return localStorage.getItem(ZONES_KEY) !== "0";
  } catch {
    return true;
  }
}
function saveShowZones(on: boolean) {
  try {
    localStorage.setItem(ZONES_KEY, on ? "1" : "0");
  } catch {
    /* 存不了就只在本次生效 */
  }
}

function Kpi({ label, value, total, tone }: { label: string; value: number; total?: number; tone?: "ok" | "alert" }) {
  return (
    <div className={`mon-kpi${tone === "alert" ? " alert" : ""}`}>
      <div className="mon-kpi-label">{label}</div>
      <div className="mon-kpi-value">
        <span className={tone === "ok" ? "ok" : undefined}>{value}</span>
        {total !== undefined && <small> / {total}</small>}
      </div>
    </div>
  );
}

/** 选中房间：平面图 + 实时目标 */
function RoomLive({
  tile,
  live,
  now,
  onProcess,
  onReplay,
}: {
  tile: RoomTile;
  live: Record<string, LiveData | undefined>;
  now: number;
  onProcess: (a: OpsAlert) => void;
  /** 不传 sn = 房间里全部雷达一起回溯 */
  onReplay: (sn?: string) => void;
}) {
  const { room, devices, alert } = tile;
  const [design, setDesign] = useState<{ roomId: string; d?: RoomDesign; error?: string }>();
  useEffect(() => {
    let dead = false;
    setDesign(undefined);
    getRoomDesign(room.id).then(
      (d) => !dead && setDesign({ roomId: room.id, d }),
      (e) => !dead && setDesign({ roomId: room.id, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      dead = true;
    };
  }, [room.id]);

  const d = design?.roomId === room.id ? design.d : undefined;
  const size = roomSize(d, room);
  const configs = useMemo(() => new Map(radarElements(d).flatMap((e) => (e.sn && e.qingLanConfig ? [[e.sn, e.qingLanConfig] as const] : []))), [d]);
  const planRadars: PlanRadar[] = useMemo(
    () =>
      devices.map((dev) => ({
        sn: dev.sn,
        label: dev.deviceName || dev.sn,
        config: configs.get(dev.sn),
        element: radarElements(d).find((e) => e.sn === dev.sn),
      })),
    [devices, configs, d],
  );

  const sns = useMemo(() => devices.map((x) => x.sn), [devices]);
  const targets = useLiveTargets(sns);
  const unplaced = devices.filter((x) => !configs.has(x.sn));
  // 床位监护的雷达（工作模式 15，或者报过体征的）按床显示体征；点下面的床位行在图上突出这张床
  const beds = devices.filter((x) => {
    const c = configs.get(x.sn);
    return (c && modeOf(c) === 15) || hasVitals(live[x.sn]);
  });
  const others = devices.filter((x) => !beds.includes(x));
  const vitals = new Map(beds.map((x) => [x.sn, bedVitals(live[x.sn], now)]));
  const [focusSn, setFocusSn] = useState<string>();
  const [showZones, setShowZones] = useState(savedShowZones);

  return (
    <section className="mon-live-room" aria-label="房间实时">
      <div className="mon-live-head">
        <div className="mon-live-title">
          <h2>{room.roomName}</h2>
          <span className="mon-sub">{[room.buildingName, room.floorName].filter(Boolean).join(" / ")}</span>
          {alert ? (
            <span className="mon-tag alert">
              {alert.alertTypeName} · {tile.meta.split(" · ").pop()}
            </span>
          ) : (
            <span className={`mon-tag ${tile.kind}`}>{tile.state}</span>
          )}
        </div>
        <div className="mon-actions">
          {devices.length > 0 && (
            <button
              className="mon-btn"
              aria-pressed={showZones}
              title={showZones ? "隐藏雷达的监测范围和区域，只看房间、家具和人" : "显示雷达的监测范围和区域（床、门、感应区）"}
              onClick={() => {
                setShowZones(!showZones);
                saveShowZones(!showZones);
              }}
            >
              {showZones ? "隐藏区域" : "显示区域"}
            </button>
          )}
          {devices.length > 0 && (
            <button className="mon-btn" onClick={() => onReplay(devices.length > 1 ? undefined : devices[0].sn)}>
              时间回溯
            </button>
          )}
          {alert && (
            <button className="mon-btn danger" onClick={() => onProcess(alert)}>
              处理告警
            </button>
          )}
        </div>
      </div>

      <div className="mon-plan-wrap">
        {!devices.length ? (
          <div className="mon-empty">这个房间没有绑定雷达</div>
        ) : design?.error ? (
          <div className="mon-empty">读取房间布置失败：{design.error}</div>
        ) : !d ? (
          <div className="mon-empty">加载房间布置…</div>
        ) : (
          <RoomPlan key={room.id} design={d} size={size} radars={planRadars} className="dark" zoomable focusSn={focusSn} showZones={showZones}>
            {(fs) => (
              <>
                {beds.map((b) => {
                  const c = configs.get(b.sn);
                  return c ? <VitalsTag key={b.sn} c={c} v={vitals.get(b.sn)!} fs={fs} /> : null;
                })}
                {targets.map((t) => (
                  <TargetMark key={`${t.sn}#${t.id}`} t={t} config={configs.get(t.sn)} fs={fs} />
                ))}
              </>
            )}
          </RoomPlan>
        )}
      </div>

      {beds.length > 0 && (
        <div className="mon-beds">
          {beds.map((b) => {
            const v = vitals.get(b.sn)!;
            const at = live[b.sn]?.updatedAt;
            return (
              <button
                key={b.sn}
                className={`mon-bed ${v.state} ${v.level}${focusSn === b.sn ? " on" : ""}`}
                onClick={() => setFocusSn((x) => (x === b.sn ? undefined : b.sn))}
                title={b.deviceName || b.sn}
              >
                <b>{bedName(b.deviceName, room.roomName, b.sn)}</b>
                <span className="mon-bed-state">{v.state === "in" ? `在床${v.text === "在床" ? "" : v.text}` : v.text}</span>
                <span className="mon-bed-v">{v.state === "in" ? `♥ ${v.heartRate ?? "—"}` : ""}</span>
                <span className="mon-bed-v">{v.state === "in" ? `≋ ${v.respiratoryRate ?? "—"}` : ""}</span>
                <span className="mon-bed-issue">{v.issue ?? ""}</span>
                <span className="mon-bed-at">{at ? `数据 ${durationText(now - at)}前` : "还没收到推送"}</span>
                <span className="mono mon-bed-sn">{b.sn.slice(-4)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mon-live-foot">
        {others.map((dev) => {
          const c = configs.get(dev.sn);
          const at = live[dev.sn]?.updatedAt;
          return (
            <span key={dev.sn} className="mon-dev">
              <b className="mono">{dev.sn}</b>
              {c && (
                <span>
                  {MOUNT[mountOf(c)]} · {MODE[modeOf(c)] ?? `模式 ${modeOf(c)}`}
                </span>
              )}
              <span>{at ? `数据 ${durationText(now - at)}前` : "还没收到推送"}</span>
            </span>
          );
        })}
        <span className="mon-spacer" />
        {unplaced.length > 0 && <span className="mon-warn">{unplaced.map((x) => x.deviceName || x.sn).join("、")} 没有区域配置，不显示位置</span>}
        <span>滚轮缩放 · 拖动平移 · 双击复位</span>
        <span>
          坐标单位 cm · {(size.width / 100).toFixed(1)} × {(size.height / 100).toFixed(1)} m
        </span>
      </div>
    </section>
  );
}

/**
 * 床上的体征标签：贴在监护床区域的左下角（不跟着人的点走，点会抖）。
 * 呼吸那一格按实际呼吸频率一明一暗，看着就知道数据是活的
 */
function VitalsTag({ c, v, fs }: { c: QlConfig; v: BedVitals; fs: number }) {
  const z = zonesOf(c).find((x) => x.type === 5) ?? zonesOf(c).find((x) => x.type === 2);
  if (!z) return null;
  const r = zoneRect(c, z);
  const breath = v.respiratoryRate ? Math.min(10, Math.max(1.5, 60 / v.respiratoryRate)) : undefined;
  // 心跳同理：按实际心率跳（一拍的时长 = 60 / 心率 秒）
  const beat = v.heartRate ? Math.min(2, Math.max(0.3, 60 / v.heartRate)) : undefined;
  return (
    <foreignObject x={r.x + fs * 0.3} y={r.y + r.height - fs * 2.1} width={Math.max(r.width, fs * 16)} height={fs * 2} className="mon-vt-fo">
      <div className={`mon-vt ${v.state} ${v.level}`} style={{ fontSize: fs * 0.85 }}>
        <b>{v.state === "in" ? (v.issue ?? v.text) : v.text}</b>
        {v.state === "in" && (
          <>
            <span>
              <i className="mon-heart" style={beat ? { animationDuration: `${beat}s` } : { animation: "none" }}>
                {"\u2665"}
              </i>
              {` ${v.heartRate ?? "\u2014"}`}
            </span>
            <span>
              {/* \u4E09\u6761\u6CE2\u6D6A\u6309\u547C\u5438\u8282\u594F\u4ECE\u4E0B\u5F80\u4E0A\u4F9D\u6B21\u4EAE\u8D77\uFF0C\u4E00\u6B21\u547C\u5438\u4E00\u4E2A\u6765\u56DE */}
              <svg className={`mon-wave${breath ? "" : " still"}`} viewBox="0 0 16 12" aria-hidden="true" style={breath ? ({ "--d": `${breath}s` } as React.CSSProperties) : undefined}>
                <path d="M1 3q2-2 4 0t4 0t4 0" />
                <path d="M1 6.5q2-2 4 0t4 0t4 0" />
                <path d="M1 10q2-2 4 0t4 0t4 0" />
              </svg>
              {` ${v.respiratoryRate ?? "\u2014"}`}
            </span>
          </>
        )}
      </div>
    </foreignObject>
  );
}

/** 过一串点的平滑曲线（Catmull-Rom 转三次贝塞尔） */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/**
 * 平面图上的一个人：最近 20 秒的轨迹 + 当前位置 + 姿态。
 * 设备约 1 秒报一次位置，直接跳过去看着一顿一顿的：点用 CSS 过渡从上一个位置匀速移到新位置，时长 = 这个目标的上报间隔，
 * 所以画面比实际晚一个上报间隔（约 1 秒），换来连续的移动。轨迹画到上一个点为止，点在它前面走，不会被轨迹"甩"在后面
 */
function TargetMark({ t, config, fs }: { t: LiveTarget; config?: QlConfig; fs: number }) {
  if (!config) return null;
  const [x, y] = liveToRoom(config, t.x, t.y);
  const pts = t.trail.slice(0, -1).map(([a, b]) => liveToRoom(config, a, b));
  const alarm = t.posture !== undefined && [2, 5, 7, 8, 10, 11].includes(t.posture);
  const r = fs * 0.6;
  // 只写姿态：目标序号是每台雷达各自编的（两台雷达都有"目标 0"），写出来反而让人糊涂
  const label = t.posture !== undefined ? POSTURE[t.posture] : "有人";
  return (
    <g className={`mon-target${alarm ? " alarm" : ""}`}>
      {pts.length > 1 && <path d={smoothPath(pts)} className="mon-trail" strokeWidth={2} />}
      <g className="mon-target-pos" style={{ transform: `translate(${x}px, ${y}px)`, transitionDuration: `${Math.round(t.dt)}ms` }}>
        {alarm && <circle r={r * 1.6} className="mon-ring" />}
        <circle r={r} className="mon-dot-t" strokeWidth={2} />
        <text x={r * 1.5} y={-r * 1.2} fontSize={fs} className="mon-target-label">
          {label}
        </text>
      </g>
    </g>
  );
}

function AlertCard({ a, onSelect, onProcess, onReplay }: { a: OpsAlert; onSelect: () => void; onProcess: () => void; onReplay?: () => void }) {
  const lv = alertLevel(a);
  const where = [a.floorName, a.roomName].filter(Boolean).join(" ") || "位置未配置";
  const detail = a.alertStatus === 1 ? a.deviceName || a.sn : [a.alertProcessTypeName, a.processByUserName].filter(Boolean).join(" · ") || "已处理";
  return (
    <article className={`mon-alert ${lv}`}>
      <button className="mon-alert-main" onClick={onSelect}>
        <span className="mon-alert-top">
          <b>{a.alertTypeName}</b>
          <span className="mono">{a.createdAt.slice(5, 19)}</span>
        </span>
        <span className="mon-alert-where">
          {where}
          {detail ? ` · ${detail}` : ""}
        </span>
      </button>
      <span className="mon-alert-actions">
        {a.alertStatus === 1 && (
          <button className={`mon-btn small ${lv === "high" ? "danger" : "warn"}`} onClick={onProcess}>
            处理
          </button>
        )}
        {onReplay && (
          <button className="mon-btn small" onClick={onReplay}>
            回溯
          </button>
        )}
      </span>
    </article>
  );
}

/** 处理告警：选处理类型、写处理结果（与网页端、用户端的处理弹窗提交的内容一致） */
function ProcessDialog({ alert, onClose, onDone }: { alert: OpsAlert | null; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [types, setTypes] = useState<{ label: string; value: string }[]>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ type: string; result?: string }>();

  useEffect(() => {
    if (alert && !types) getProcessTypes().then(setTypes, () => setTypes([]));
    if (alert) form.resetFields();
  }, [alert, types, form]);

  async function submit() {
    if (!alert) return;
    const v = await form.validateFields();
    setSaving(true);
    try {
      await processAlert(alert.id, v.type, v.result?.trim() ?? "");
      message.success("已处理");
      onClose();
      onDone();
    } catch (e) {
      message.error(`处理失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!alert} title="处理告警" okText="提交" onOk={submit} confirmLoading={saving} onCancel={onClose} destroyOnHidden>
      {alert && (
        <>
          <p className="mon-process-what">
            <b>{alert.alertTypeName}</b> · {[alert.buildingName, alert.floorName, alert.roomName].filter(Boolean).join(" / ") || "位置未配置"} · {alert.createdAt}
          </p>
          <Form form={form} layout="vertical">
            <Form.Item name="type" label="处理类型" rules={[{ required: true, message: "选择处理类型" }]}>
              <Select loading={!types} options={types} placeholder="选择" />
            </Form.Item>
            <Form.Item name="result" label="处理结果">
              <Input.TextArea rows={3} maxLength={200} placeholder="例如：已到房间查看，老人安好" />
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  );
}
