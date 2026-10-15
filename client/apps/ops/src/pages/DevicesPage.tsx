import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, Spin } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { getDeviceTypeMap, getRadars, type Radar } from "../api/device";
import DeviceDetail from "../devices/DeviceDetail";

type Filter = "all" | "online" | "offline" | "disabled";

const FILTERS: { key: Filter; label: string; test: (d: Radar) => boolean }[] = [
  { key: "all", label: "全部", test: () => true },
  { key: "online", label: "在线", test: (d) => d.isOnline && !d.isDisabled },
  { key: "offline", label: "离线", test: (d) => !d.isOnline && !d.isDisabled },
  { key: "disabled", label: "停用", test: (d) => d.isDisabled },
];

export function lastSeen(t?: string) {
  if (!t) return "—";
  const d = dayjs(t);
  return d.isValid() ? d.fromNow() : t;
}

/** 设备工作台：左侧雷达列表（客户端筛选，↑↓ 切换），右侧设备详情 */
export default function DevicesPage({ onOpenLogs }: { onOpenLogs: (sn: string) => void }) {
  const { message } = App.useApp();
  const [list, setList] = useState<Radar[]>([]);
  const [types, setTypes] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string>();
  /** 收起左侧列表，给详情（尤其是姿态回放）更多空间 */
  const [listHidden, setListHidden] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await getRadars());
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

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, list.filter(f.test).length])) as Record<Filter, number>, [list]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return list
      .filter(test)
      .filter((d) => !kw || [d.deviceName, d.sn, d.roomName, d.realName].some((v) => v?.toLowerCase().includes(kw)))
      // 在线的排前面，其次按最近活动时间
      .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || (b.lastActivityTime ?? "").localeCompare(a.lastActivityTime ?? ""));
  }, [list, filter, q]);

  const sel = shown.find((d) => d.id === selId) ?? list.find((d) => d.id === selId);

  // 默认选中第一台
  useEffect(() => {
    if (!selId && shown.length) setSelId(shown[0].id);
  }, [selId, shown]);

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
      <section className="dev-list" onKeyDown={onKeyDown} hidden={listHidden}>
        <div className="dev-list-head">
          <div className="dev-list-title">
            <h1>雷达设备</h1>
            <span className="muted">
              {list.length} 台 · {counts.online} 在线
            </span>
            <Button type="text" icon={<ReloadOutlined />} onClick={load} title="刷新" style={{ marginLeft: "auto" }} />
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
            shown.map((d) => (
              <div
                key={d.id}
                data-id={d.id}
                role="option"
                aria-selected={d.id === selId}
                className={`dev-row${d.id === selId ? " on" : ""}`}
                onClick={() => setSelId(d.id)}
              >
                <i className={`dot ${d.isDisabled ? "disabled" : d.isOnline ? "online" : "offline"}`} />
                <span className="dev-row-main">
                  <b>{d.deviceName || d.sn}</b>
                  <small>
                    <span className="mono">{d.sn}</span> · {d.roomName || "未绑定房间"}
                  </small>
                </span>
                <span className={`dev-row-last${d.isOnline ? "" : " off"}`}>{lastSeen(d.lastActivityTime)}</span>
              </div>
            ))
          )}
        </div>
        <div className="dev-list-foot muted">
          显示 {shown.length} / {list.length} · ↑↓ 切换
        </div>
      </section>
      <section className="dev-detail">
        {sel ? (
          <DeviceDetail key={sel.id} d={sel} typeName={sel.deviceType !== undefined ? types.get(sel.deviceType) : undefined} onOpenLogs={onOpenLogs} listHidden={listHidden} onToggleList={() => setListHidden((v) => !v)} />
        ) : (
          <Empty style={{ marginTop: 120 }} description="选择左侧的设备查看详情" />
        )}
      </section>
    </div>
  );
}
