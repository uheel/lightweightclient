import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, Progress, Spin } from "antd";
import { FileSearchOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { perfTimer } from "@radar/core";
import { getDeviceTypeMap, getRadars, getStoredProperties, type Radar, type StoredProperty } from "../api/device";
import { getRoomDesign, getRooms, radarElements, readFromDevice, type Room, type RoomDesign } from "../api/room";
import { getDeviceScenes, type Scene } from "../api/scene";
import { checkRoom, ZONE_TYPES, type Level, type RadarReport, type RoomReport } from "../rooms/check";
import RoomDetail, { IssueItem, LEVEL_TEXT, type DeviceRead } from "../rooms/RoomDetail";
import { pool } from "../scenes/plan";

type Filter = "all" | "radar" | "problem";

const FILTERS: { key: Filter; label: string; test: (r: RoomReport) => boolean }[] = [
  { key: "all", label: "全部", test: () => true },
  { key: "radar", label: "有雷达", test: (r) => r.radars.length > 0 },
  { key: "problem", label: "有问题", test: (r) => r.level === "error" || r.level === "warn" },
];

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const byName = (a?: string, b?: string) => (a ?? "").localeCompare(b ?? "", "zh-CN", { numeric: true });
const roomOrder = (a: Room, b: Room) =>
  (a.buildingSortOrder ?? 0) - (b.buildingSortOrder ?? 0) ||
  byName(a.buildingName, b.buildingName) ||
  (a.floorNumber ?? 0) - (b.floorNumber ?? 0) ||
  byName(a.floorName, b.floorName) ||
  (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
  byName(a.roomName, b.roomName);

type DesignState = { design?: RoomDesign; error?: string };

/**
 * 房间布置：左侧房间列表（带体检状态），右侧房间平面图和每台雷达的配置、问题、下发数据比对。
 * 进页面时一次取回房间、设备，以及有雷达的房间的布置、平台记录、设备场景，之后筛选、搜索、体检都在本地算。
 */
export default function RoomsPage() {
  const { message } = App.useApp();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [devices, setDevices] = useState<Radar[]>([]);
  const [types, setTypes] = useState<Map<number, string>>(new Map());
  const [designs, setDesigns] = useState<Map<string, DesignState>>(new Map());
  const [values, setValues] = useState<Map<string, Record<string, StoredProperty>>>(new Map());
  const [scenes, setScenes] = useState<Map<string, Scene[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string>();
  /** 右侧显示体检报告（全部问题）还是单个房间 */
  const [showReport, setShowReport] = useState(true);
  const [reads, setReads] = useState<Record<string, DeviceRead>>({});
  const loadSeq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  /** 取设备的平台记录和场景（已经取过的跳过） */
  const loadDeviceData = useCallback(async (list: Radar[], onDone?: () => void) => {
    const v = new Map<string, Record<string, StoredProperty>>();
    const s = new Map<string, Scene[]>();
    await pool(list, 6, async (d) => {
      const [vals, sc] = await Promise.all([getStoredProperties(d.sn).catch(() => ({})), getDeviceScenes(d.id).catch(() => [])]);
      v.set(d.sn, vals);
      s.set(d.id, sc);
      onDone?.();
    });
    setValues((m) => new Map([...m, ...v]));
    setScenes((m) => new Map([...m, ...s]));
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setReads({});
    const pt = perfTimer("房间体检");
    try {
      const [r, d] = await Promise.all([getRooms(), getRadars()]);
      if (seq !== loadSeq.current) return;
      pt.lap("rooms+devices");
      setRooms(r);
      setDevices(d);
      setDesigns(new Map());
      setValues(new Map());
      setScenes(new Map());
      // 只有绑了雷达的房间才先取布置；其他房间点开时再取
      const roomIds = [...new Set(d.map((x) => x.roomId).filter((x): x is string => !!x))];
      const zoned = d.filter((x) => x.roomId && (x.deviceType === undefined || ZONE_TYPES.has(x.deviceType)));
      const total = roomIds.length + zoned.length;
      let done = 0;
      const tick = () => seq === loadSeq.current && setProgress({ done: ++done, total });
      setProgress({ done: 0, total });
      const ds = new Map<string, DesignState>();
      await Promise.all([
        pool(roomIds, 6, async (id) => {
          try {
            ds.set(id, { design: await getRoomDesign(id) });
          } catch (e) {
            ds.set(id, { error: errText(e) });
          }
          tick();
        }),
        loadDeviceData(zoned, tick),
      ]);
      if (seq !== loadSeq.current) return;
      setDesigns(ds);
      pt.lap("details");
      pt.info("rooms", r.length);
      pt.info("devices", zoned.length);
      pt.endAfterPaint();
    } catch (e) {
      message.error(`加载失败：${errText(e)}`);
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
        setProgress(undefined);
      }
    }
  }, [loadDeviceData, message]);

  useEffect(() => {
    load();
    getDeviceTypeMap().then(setTypes, () => {});
  }, [load]);

  const typeName = useCallback((t?: number) => (t === undefined ? "未知型号" : types.get(t) ?? `型号 ${t}`), [types]);

  const reports = useMemo(() => {
    const m = new Map<string, RoomReport>();
    for (const room of [...rooms].sort(roomOrder)) {
      const ds = designs.get(room.id);
      m.set(room.id, checkRoom({ room, design: ds?.design, designError: ds?.error, devices, values, scenes }));
    }
    return m;
  }, [rooms, designs, devices, values, scenes]);

  const all = useMemo(() => [...reports.values()], [reports]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, all.filter(f.test).length])) as Record<Filter, number>, [all]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return all.filter(
      (r) =>
        test(r) &&
        (!kw ||
          [r.room.roomName, r.room.buildingName, r.room.floorName, ...r.radars.flatMap((x) => [x.sn, x.device?.deviceName])].some((v) => v?.toLowerCase().includes(kw))),
    );
  }, [all, filter, q]);

  const sel = selId ? reports.get(selId) : undefined;

  // 点开还没取过布置的房间：取布置，布置里有雷达再取它们的记录和场景
  useEffect(() => {
    if (!selId || loading || designs.has(selId)) return;
    let alive = true;
    getRoomDesign(selId).then(
      (design) => {
        if (!alive) return;
        setDesigns((m) => new Map(m).set(selId, { design }));
        const sns = new Set(radarElements(design).map((e) => e.sn));
        const need = devices.filter((d) => sns.has(d.sn) && !values.has(d.sn));
        if (need.length) loadDeviceData(need);
      },
      (e) => alive && setDesigns((m) => new Map(m).set(selId, { error: errText(e) })),
    );
    return () => {
      alive = false;
    };
  }, [selId, loading, designs, devices, values, loadDeviceData]);

  function pick(id: string) {
    setSelId(id);
    setShowReport(false);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = shown.findIndex((r) => r.room.id === selId);
    const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) pick(next.room.id);
  }

  async function readDevice(r: RadarReport) {
    const sn = r.sn;
    setReads((m) => ({ ...m, [sn]: { ...m[sn], loading: true, error: undefined } }));
    try {
      const data = await readFromDevice(sn, ["QL_radar_config", "QL_radar_area"]);
      setReads((m) => ({ ...m, [sn]: { at: Date.now(), config: data.QL_radar_config ?? data.QL_radar_para_config, area: data.QL_radar_area ?? data.QL_radar_para_area } }));
      // 平台会把读回的值存成记录，刷新一下
      getStoredProperties(sn).then((v) => setValues((m) => new Map(m).set(sn, v)), () => {});
    } catch (e) {
      setReads((m) => ({ ...m, [sn]: { at: undefined, error: `读取失败：${errText(e)}` } }));
    }
  }

  const levelDot = (l: Level) => (l === "error" ? "bad" : l === "warn" ? "warn" : l === "ok" ? "good" : "none");

  return (
    <div className="workbench">
      <section className="dev-list room-list" onKeyDown={onKeyDown}>
        <div className="dev-list-head">
          <div className="dev-list-title">
            <h1>房间布置</h1>
            <span className="muted">
              {rooms.length} 间 · {counts.problem} 间有问题
            </span>
            <Button type="text" icon={<ReloadOutlined />} onClick={load} title="重新体检" style={{ marginLeft: "auto" }} />
          </div>
          <Input allowClear prefix={<SearchOutlined style={{ color: "#8A8FA8" }} />} placeholder="房间 / 楼栋 / 楼层 / 设备" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg">
            {FILTERS.map((f) => (
              <button key={f.key} className={f.key === filter ? "on" : ""} onClick={() => setFilter(f.key)}>
                {f.label} <b>{counts[f.key]}</b>
              </button>
            ))}
          </div>
        </div>
        <button className={`room-report-entry${showReport ? " on" : ""}`} onClick={() => setShowReport(true)}>
          <FileSearchOutlined /> 体检报告
          <span className="grow" />
          {progress ? <span className="muted small">检查中 {progress.done}/{progress.total}</span> : <b>{counts.problem}</b>}
        </button>
        <div className="dev-rows" ref={listRef} tabIndex={0} role="listbox" aria-label="房间">
          {loading && !rooms.length ? (
            <Spin style={{ margin: 40 }} />
          ) : shown.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的房间" />
          ) : (
            shown.map((r) => {
              const n = r.radars.reduce((k, x) => k + x.issues.length, 0) + r.issues.length;
              return (
                <div
                  key={r.room.id}
                  data-id={r.room.id}
                  role="option"
                  aria-selected={!showReport && r.room.id === selId}
                  className={`dev-row${!showReport && r.room.id === selId ? " on" : ""}`}
                  onClick={() => pick(r.room.id)}
                >
                  <i className={`lvl ${levelDot(r.level)}`} />
                  <span className="dev-row-main">
                    <b>{r.room.roomName}</b>
                    <small>
                      {[r.room.buildingName, r.room.floorName].filter(Boolean).join(" · ")}
                      {r.radars.length > 0 && ` · ${r.radars.length} 台雷达`}
                    </small>
                  </span>
                  {r.level === "error" || r.level === "warn" ? (
                    <span className={`dev-row-last room-n ${r.level}`}>{n} 个问题</span>
                  ) : r.level === "ok" ? (
                    <span className="dev-row-last off">正常</span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
        <div className="dev-list-foot muted">显示 {shown.length} / {rooms.length} · ↑↓ 切换</div>
      </section>
      <section className="dev-detail">
        {showReport ? (
          <Report reports={all} loading={loading} progress={progress} onPick={pick} />
        ) : sel ? (
          designs.has(sel.room.id) || sel.radars.length ? (
            <RoomDetail key={sel.room.id} report={sel} typeName={typeName} reads={reads} onRead={readDevice} />
          ) : (
            <Spin style={{ margin: 80 }} />
          )
        ) : (
          <Empty style={{ marginTop: 120 }} description="选择左侧的房间" />
        )}
      </section>
    </div>
  );
}

/** 体检报告：机构里所有房间的问题，点一条跳到那个房间 */
function Report({ reports, loading, progress, onPick }: { reports: RoomReport[]; loading: boolean; progress?: { done: number; total: number }; onPick: (id: string) => void }) {
  const bad = reports.filter((r) => r.level === "error" || r.level === "warn");
  const withRadar = reports.filter((r) => r.radars.length > 0);
  const radars = withRadar.flatMap((r) => r.radars);
  const n = (l: Level) => radars.filter((x) => x.level === l).length;
  const sum = (l: "error" | "warn") => reports.reduce((k, r) => k + r.issues.filter((i) => i.level === l).length + r.radars.reduce((j, x) => j + x.issues.filter((i) => i.level === l).length, 0), 0);

  return (
    <div className="detail room-detail">
      <div className="detail-head">
        <div className="detail-title">
          <h1>体检报告</h1>
        </div>
        <div className="detail-sub room-sub">
          <span>房间布置、区域、平台记录和场景里的区域引用，都在本地按已取回的数据检查；设备上实际是什么，到房间里点"读设备核对"</span>
        </div>
      </div>
      {progress && (
        <div className="ops-card">
          读取房间布置、平台记录和设备场景 {progress.done} / {progress.total}
          <Progress percent={Math.round((progress.done / Math.max(1, progress.total)) * 100)} size="small" showInfo={false} />
        </div>
      )}
      <div className="kpis">
        <div>
          <small>有雷达的房间</small>
          <b>{withRadar.length}</b>
        </div>
        <div>
          <small>雷达：正常 / 需注意 / 有问题</small>
          <b>
            {n("ok")} / {n("warn")} / {n("error")}
          </b>
        </div>
        <div>
          <small>问题</small>
          <b className="err-text">{sum("error")}</b>
        </div>
        <div>
          <small>提醒</small>
          <b>{sum("warn")}</b>
        </div>
      </div>
      {!loading && !bad.length && <Empty style={{ marginTop: 40 }} description="没有发现问题" />}
      {bad.map((r) => (
        <div key={r.room.id} className="ops-card report-room" onClick={() => onPick(r.room.id)} role="button">
          <h2>
            <span>{r.room.roomName}</span>
            <small className="muted">{[r.room.buildingName, r.room.floorName].filter(Boolean).join(" · ")}</small>
            <span className="grow" />
            <span className={`grade ${r.level === "error" ? "bad" : "warn"}`}>{LEVEL_TEXT[r.level]}</span>
          </h2>
          <ul className="issues">
            {r.issues.map((i, k) => (
              <IssueItem key={`r${k}`} i={i} />
            ))}
            {r.radars.flatMap((x) => x.issues.map((i, k) => <IssueItem key={`${x.sn}${k}`} i={i} who={x.device?.deviceName || x.sn || "未绑设备"} />))}
          </ul>
        </div>
      ))}
    </div>
  );
}
