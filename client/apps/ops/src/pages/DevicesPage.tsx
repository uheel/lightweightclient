import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, Select, Spin } from "antd";
import { HddOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { deviceLink, perfTimer, type DeviceLink } from "@radar/core";
import { CAREGIVER_WATCH_TYPE, getAllDevices, getDeviceTypeGroups, getDeviceTypeMap, getRadars } from "../api/device";
import { getMasters, MASTER_TYPE } from "../api/master";
import AddDeviceDialog from "../devices/AddDeviceDialog";
import DeviceDetail from "../devices/DeviceDetail";
import BasicDetail from "../devices/BasicDetail";
import MasterDetail from "../devices/master/MasterDetail";
import { CATS, catLabel, catOf, type DevCat, type DevRow } from "../devices/category";
import { useLiveMap } from "../devices/useLiveMap";
import { useGuide, useGuideFocus } from "../guide/GuideContext";
import type { Spot } from "../rooms/qinglan";
import { GuideEmpty } from "../guide/GuideEmpty";

type Filter = "all" | "online" | "offline" | "disabled";

const FILTERS: { key: Filter; label: string; test: (d: DevRow, l: DeviceLink) => boolean }[] = [
  { key: "all", label: "全部", test: () => true },
  { key: "online", label: "在线", test: (d, l) => l.online && !d.isDisabled },
  { key: "offline", label: "离线", test: (d, l) => !l.online && !d.isDisabled },
  { key: "disabled", label: "停用", test: (d) => d.isDisabled },
];

/** 设备不多时订阅全部设备的实时推送，在线状态全部以设备数据为准；太多时只订阅选中的那台，其余先用平台记录 */
const SUBSCRIBE_ALL_MAX = 300;

/** 左侧列表宽度可拖动调整，记在本机 */
const LIST_W_KEY = "ops:dev-list-width";
const LIST_W_DEFAULT = 340;
const clampListW = (w: number) => Math.round(Math.min(560, Math.max(280, w)));
function savedListW() {
  try {
    const v = Number(localStorage.getItem(LIST_W_KEY));
    return v ? clampListW(v) : LIST_W_DEFAULT;
  } catch {
    return LIST_W_DEFAULT;
  }
}

export function lastSeen(t?: string | number) {
  if (!t) return "—";
  const d = dayjs(t);
  return d.isValid() ? d.fromNow() : t;
}

/** 选中的设备类型记在本机 */
const CAT_KEY = "ops:dev-cat";
function savedCat(): DevCat | "all" {
  try {
    const v = localStorage.getItem(CAT_KEY);
    return v && CATS.some((c) => c.key === v) ? (v as DevCat) : "all";
  } catch {
    return "all";
  }
}

/**
 * 机构里的全部设备：雷达用雷达列表（字段多），管理主机用主机列表（带 SIP），其余类型用全类型列表；
 * 三个接口并发取，按 id 去重（同一台以前面的为准）
 */
async function loadAllDevices(): Promise<DevRow[]> {
  const [radars, masters, all, groups] = await Promise.all([
    getRadars(),
    getMasters().catch(() => []),
    getAllDevices().catch(() => []),
    getDeviceTypeGroups().catch(() => new Map<number, string>()),
  ]);
  const seen = new Set<string>();
  const rows: DevRow[] = [];
  const add = (r: DevRow) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    rows.push(r);
  };
  for (const r of radars) add({ ...r, cat: "radar" });
  for (const m of masters) add({ ...m, cat: "master", master: m });
  for (const x of all)
    add({
      ...x,
      deviceName: x.deviceName ?? "",
      orgId: x.orgId ?? "",
      orgName: x.orgName ?? "",
      isOnline: !!x.isOnline,
      isDisabled: !!x.isDisabled,
      cat: catOf(x.deviceType, groups),
    });
  return rows;
}

/** 设备工作台：左侧设备列表（按类型、状态筛选，↑↓ 切换），右侧按类型显示对应的详情和配置 */
export default function DevicesPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<DevRow[]>([]);
  const [types, setTypes] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<DevCat | "all">(savedCat);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string>();
  /** 收起左侧列表，给详情（尤其是姿态回放）更多空间 */
  const [listHidden, setListHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  /** 从快速开始跳过来时详情里要打开、闪一下的那一项 */
  const [spot, setSpot] = useState<{ id: string; spot: Spot; seq: number }>();
  // 换到别的设备就作废，回来时不再闪
  useEffect(() => {
    if (spot && spot.id !== selId) setSpot(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);
  const [listW, setListW] = useState(savedListW);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const guide = useGuide();

  const load = useCallback(async () => {
    setLoading(true);
    const pt = perfTimer("设备列表");
    try {
      const l = await loadAllDevices();
      pt.lap("fetch");
      pt.info("rows", l.length);
      setList(l);
      pt.endAfterPaint();
      return l;
    } catch (e) {
      message.error(`加载设备失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    load();
    getDeviceTypeMap().then(setTypes, () => {});
  }, [load]);

  // 实时推送只有雷达有
  const radars = useMemo(() => list.filter((d) => d.cat === "radar"), [list]);
  const subscribeAll = radars.length <= SUBSCRIBE_ALL_MAX;
  const selSn = radars.find((d) => d.id === selId)?.sn;
  const liveSns = useMemo(() => (subscribeAll ? radars.map((d) => d.sn) : selSn ? [selSn] : []), [subscribeAll, radars, selSn]);
  const liveMap = useLiveMap(liveSns);
  // 判断"10 分钟内有没有数据"用的当前时间，每 30 秒更新
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const links = useMemo(() => {
    const m = new Map<string, DeviceLink>();
    for (const d of list) m.set(d.id, deviceLink({ live: liveMap[d.sn], platformOnline: d.isOnline, now: Math.max(now, liveMap[d.sn]?.updatedAt ?? 0) }));
    return m;
  }, [list, liveMap, now]);
  const linkOf = (d: DevRow) => links.get(d.id)!;

  /** 每种类型的台数，下拉里只列机构里有的类型 */
  const catCounts = useMemo(() => {
    const m = new Map<DevCat, number>();
    for (const d of list) m.set(d.cat, (m.get(d.cat) ?? 0) + 1);
    return m;
  }, [list]);
  const ofCat = useMemo(() => (cat === "all" ? list : list.filter((d) => d.cat === cat)), [list, cat]);

  function changeCat(c: DevCat | "all") {
    setCat(c);
    try {
      localStorage.setItem(CAT_KEY, c);
    } catch {
      /* 存不了就只在本次生效 */
    }
  }

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, ofCat.filter((d) => f.test(d, links.get(d.id)!)).length])) as Record<Filter, number>,
    [ofCat, links],
  );

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return ofCat
      .filter((d) => test(d, links.get(d.id)!))
      .filter((d) => !kw || [d.deviceName, d.sn, d.roomName, d.realName].some((v) => v?.toLowerCase().includes(kw)))
      // 在线的排前面，其次按平台记录的最近活动时间（不按实时数据排序，免得列表一直跳）
      .sort((a, b) => Number(links.get(b.id)!.online) - Number(links.get(a.id)!.online) || (b.lastActivityTime ?? "").localeCompare(a.lastActivityTime ?? ""));
  }, [ofCat, links, filter, q]);

  const sel = shown.find((d) => d.id === selId) ?? list.find((d) => d.id === selId);

  // 默认选中第一台；换了类型、选中的不是这一类时，改选这一类的第一台
  useEffect(() => {
    if ((!selId || !ofCat.some((d) => d.id === selId)) && shown.length) setSelId(shown[0].id);
  }, [selId, shown, ofCat]);

  /** 清掉筛选并选中某台设备 */
  function focusDevice(id: string) {
    changeCat("all");
    setFilter("all");
    setQ("");
    setSelId(id);
    setListHidden(false);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  /** 添加成功后刷新列表并选中新设备 */
  async function onCreated(sn: string) {
    setAdding(false);
    const l = await load();
    const d = l?.find((x) => x.sn === sn);
    if (d) focusDevice(d.id);
    guide?.refresh(true);
  }

  /** 删除后：从列表去掉，选中原来位置的下一台，再静默重取 */
  function onDeleted(id: string) {
    const i = shown.findIndex((d) => d.id === id);
    const rest = shown.filter((d) => d.id !== id);
    setSelId(rest[Math.min(Math.max(i, 0), rest.length - 1)]?.id);
    setList((l) => l.filter((d) => d.id !== id));
    load();
    guide?.refresh(true);
  }

  // 从快速开始清单跳过来：选中设备或打开添加
  useGuideFocus("devices", (f) => {
    if (f.id) focusDevice(f.id);
    if (f.id && f.spot && f.spot !== "beds") setSpot({ id: f.id, spot: f.spot, seq: f.seq });
    if (f.action === "add") setAdding(true);
  });

  function saveListW(w: number) {
    setListW(w);
    try {
      localStorage.setItem(LIST_W_KEY, String(w));
    } catch {
      /* 存不了就只在本次生效 */
    }
  }

  /** 拖动分隔条调整列表宽度 */
  function onSplitDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    const x0 = e.clientX;
    const w0 = listW;
    let w = w0;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => {
      w = clampListW(w0 + ev.clientX - x0);
      setListW(w);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDragging(false);
      saveListW(w);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  /** 列表第二行 SN 后面的说明：雷达写房间，管理主机写 SIP 号和通讯录台数，其他写设备类型 */
  function rowSub(d: DevRow) {
    if (d.cat === "radar") return d.roomName || "未绑定房间";
    if (d.cat === "master") return [cat === "all" && "管理主机", d.master?.sipUserName && `SIP ${d.master.sipUserName}`, `${d.master?.deviceCount ?? 0} 台雷达`].filter(Boolean).join(" · ");
    return (d.deviceType !== undefined && types.get(d.deviceType)) || catLabel(d.cat);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = shown.findIndex((d) => d.id === selId);
    const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      setSelId(next.id);
      listRef.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }

  return (
    <div className="workbench">
      <section className="dev-list" style={{ width: listW }} onKeyDown={onKeyDown} hidden={listHidden}>
        <div className="dev-list-head">
          <div className="dev-list-title">
            <h1>设备</h1>
            <span className="muted">
              {ofCat.length} 台 · {counts.online} 在线
            </span>
            <Button type="text" icon={<PlusOutlined />} onClick={() => setAdding(true)} title="添加设备" style={{ marginLeft: "auto" }} />
            <Button type="text" icon={<ReloadOutlined />} onClick={load} title="刷新" />
          </div>
          <div className="dev-list-search">
            <Select
              className="dev-cat"
              value={cat}
              onChange={changeCat}
              popupMatchSelectWidth={false}
              // 选中后只显示类型名，台数在下拉里看
              labelRender={({ value }) => (value === "all" ? "全部类型" : catLabel(value as DevCat))}
              options={[
                { value: "all", label: `全部类型 ${list.length}` },
                ...CATS.filter((c) => catCounts.get(c.key) || c.key === cat).map((c) => ({ value: c.key, label: `${c.label} ${catCounts.get(c.key) ?? 0}` })),
              ]}
            />
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: "#8A8FA8" }} />}
              placeholder="名称 / SN / 房间 / 长者"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="seg">
            {FILTERS.map((f) => (
              <button key={f.key} className={f.key === filter ? "on" : ""} onClick={() => setFilter(f.key)}>
                {f.label} <b>{counts[f.key]}</b>
              </button>
            ))}
          </div>
        </div>
        <div className="dev-rows" ref={listRef} tabIndex={0} role="listbox" aria-label="设备">
          {loading && !list.length ? (
            <Spin style={{ margin: 40 }} />
          ) : shown.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的设备" />
          ) : (
            shown.map((d) => {
              const l = linkOf(d);
              return (
              <div
                key={d.id}
                data-id={d.id}
                role="option"
                aria-selected={d.id === selId}
                className={`dev-row${d.id === selId ? " on" : ""}`}
                onClick={() => setSelId(d.id)}
              >
                <i className={`dot ${d.isDisabled ? "disabled" : l.online ? "online" : "offline"}`} />
                <span className="dev-row-main">
                  <b>{d.deviceName || d.sn}</b>
                  <small>
                    <span className="mono">{d.sn}</span> · {rowSub(d)}
                  </small>
                </span>
                {l.source === "device" ? (
                  <span className={`dev-row-last${l.online ? "" : " off"}`} title="最近一次收到设备数据">
                    {lastSeen(l.at)}
                  </span>
                ) : d.cat === "radar" ? (
                  <span className="dev-row-last off plat" title="还没收到这台设备的数据，显示的是平台记录，可能有延迟">
                    {lastSeen(d.lastActivityTime)}
                  </span>
                ) : null}
              </div>
              );
            })
          )}
        </div>
        <div className="dev-list-foot muted">
          显示 {shown.length} / {list.length} · ↑↓ 切换
          {!subscribeAll && (cat === "all" || cat === "radar") && <div>超过 {SUBSCRIBE_ALL_MAX} 台：只有选中的设备按实时数据判断在线，斜体为平台记录</div>}
        </div>
      </section>
      <div
        className={`dev-split${dragging ? " dragging" : ""}`}
        hidden={listHidden}
        role="separator"
        aria-orientation="vertical"
        title="拖动调整列表宽度，双击恢复默认"
        onPointerDown={onSplitDown}
        onDoubleClick={() => saveListW(LIST_W_DEFAULT)}
      />
      <section className="dev-detail">
        {!loading && !radars.length && (cat === "all" || cat === "radar") ? (
          <GuideEmpty
            icon={<HddOutlined />}
            title="添加第一台雷达"
            desc="录入雷达的 SN，选好装在哪个房间。通电联网后它会自动上线，之后在这里看安装角度、画区域。"
            need="spaces"
            needText="还没有房间，建议先建楼宇，添加雷达时就能直接选房间"
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
              添加雷达
            </Button>
          </GuideEmpty>
        ) : sel?.cat === "master" ? (
          <MasterDetail key={sel.id} d={sel} radars={radars} typeName={types.get(sel.deviceType!)} listHidden={listHidden} onToggleList={() => setListHidden((v) => !v)} onChanged={load} onDeleted={() => onDeleted(sel.id)} />
        ) : sel && sel.cat !== "radar" ? (
          <BasicDetail key={sel.id} d={sel} typeName={types.get(sel.deviceType!)} listHidden={listHidden} onToggleList={() => setListHidden((v) => !v)} onRenamed={load} onDeleted={() => onDeleted(sel.id)} />
        ) : sel ? (
          <DeviceDetail key={sel.id} d={sel} live={liveMap[sel.sn]} typeName={sel.deviceType !== undefined ? types.get(sel.deviceType) : undefined} spot={spot?.id === sel.id ? spot : undefined} listHidden={listHidden} onToggleList={() => setListHidden((v) => !v)} onMoved={load} onDeleted={() => onDeleted(sel.id)} />
        ) : (
          <Empty style={{ marginTop: 120 }} description="选择左侧的设备查看详情" />
        )}
      </section>
      <AddDeviceDialog open={adding} existing={list} defaultType={cat === "master" ? MASTER_TYPE : cat === "watch" ? CAREGIVER_WATCH_TYPE : undefined} onClose={() => setAdding(false)} onCreated={onCreated} />
    </div>
  );
}
