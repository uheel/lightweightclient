import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, Spin } from "antd";
import { HddOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { deviceLink, perfTimer, type DeviceLink } from "@radar/core";
import { getDeviceTypeMap, getRadars, type Radar } from "../api/device";
import AddDeviceDialog from "../devices/AddDeviceDialog";
import DeviceDetail from "../devices/DeviceDetail";
import { useLiveMap } from "../devices/useLiveMap";
import { useGuide, useGuideFocus } from "../guide/GuideContext";
import { GuideEmpty } from "../guide/GuideEmpty";

type Filter = "all" | "online" | "offline" | "disabled";

const FILTERS: { key: Filter; label: string; test: (d: Radar, l: DeviceLink) => boolean }[] = [
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

/** 设备工作台：左侧雷达列表（客户端筛选，↑↓ 切换），右侧设备详情 */
export default function DevicesPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<Radar[]>([]);
  const [types, setTypes] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string>();
  /** 收起左侧列表，给详情（尤其是姿态回放）更多空间 */
  const [listHidden, setListHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const [listW, setListW] = useState(savedListW);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const guide = useGuide();

  const load = useCallback(async () => {
    setLoading(true);
    const pt = perfTimer("设备列表");
    try {
      const l = await getRadars();
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

  const subscribeAll = list.length <= SUBSCRIBE_ALL_MAX;
  const selSn = list.find((d) => d.id === selId)?.sn;
  const liveSns = useMemo(() => (subscribeAll ? list.map((d) => d.sn) : selSn ? [selSn] : []), [subscribeAll, list, selSn]);
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
  const linkOf = (d: Radar) => links.get(d.id)!;

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, list.filter((d) => f.test(d, links.get(d.id)!)).length])) as Record<Filter, number>,
    [list, links],
  );

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return list
      .filter((d) => test(d, links.get(d.id)!))
      .filter((d) => !kw || [d.deviceName, d.sn, d.roomName, d.realName].some((v) => v?.toLowerCase().includes(kw)))
      // 在线的排前面，其次按平台记录的最近活动时间（不按实时数据排序，免得列表一直跳）
      .sort((a, b) => Number(links.get(b.id)!.online) - Number(links.get(a.id)!.online) || (b.lastActivityTime ?? "").localeCompare(a.lastActivityTime ?? ""));
  }, [list, links, filter, q]);

  const sel = shown.find((d) => d.id === selId) ?? list.find((d) => d.id === selId);

  // 默认选中第一台
  useEffect(() => {
    if (!selId && shown.length) setSelId(shown[0].id);
  }, [selId, shown]);

  /** 清掉筛选并选中某台设备 */
  function focusDevice(id: string) {
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

  // 从快速开始清单跳过来：选中设备或打开添加
  useGuideFocus("devices", (f) => {
    if (f.id) focusDevice(f.id);
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
            <h1>雷达设备</h1>
            <span className="muted">
              {list.length} 台 · {counts.online} 在线
            </span>
            <Button type="text" icon={<PlusOutlined />} onClick={() => setAdding(true)} title="添加设备" style={{ marginLeft: "auto" }} />
            <Button type="text" icon={<ReloadOutlined />} onClick={load} title="刷新" />
          </div>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: "#8A8FA8" }} />}
            placeholder="名称 / SN / 房间 / 长者"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
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
                    <span className="mono">{d.sn}</span> · {d.roomName || "未绑定房间"}
                  </small>
                </span>
                {l.source === "device" ? (
                  <span className={`dev-row-last${l.online ? "" : " off"}`} title="最近一次收到设备数据">
                    {lastSeen(l.at)}
                  </span>
                ) : (
                  <span className="dev-row-last off plat" title="还没收到这台设备的数据，显示的是平台记录，可能有延迟">
                    {lastSeen(d.lastActivityTime)}
                  </span>
                )}
              </div>
              );
            })
          )}
        </div>
        <div className="dev-list-foot muted">
          显示 {shown.length} / {list.length} · ↑↓ 切换
          {!subscribeAll && <div>超过 {SUBSCRIBE_ALL_MAX} 台：只有选中的设备按实时数据判断在线，斜体为平台记录</div>}
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
        {!loading && !list.length ? (
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
        ) : sel ? (
          <DeviceDetail key={sel.id} d={sel} live={liveMap[sel.sn]} typeName={sel.deviceType !== undefined ? types.get(sel.deviceType) : undefined} listHidden={listHidden} onToggleList={() => setListHidden((v) => !v)} onMoved={load} />
        ) : (
          <Empty style={{ marginTop: 120 }} description="选择左侧的设备查看详情" />
        )}
      </section>
      <AddDeviceDialog open={adding} existing={list} onClose={() => setAdding(false)} onCreated={onCreated} />
    </div>
  );
}
