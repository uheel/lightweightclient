import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Segmented, Table, type TableColumnsType } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useCare } from "../care/CareContext";
import { getAlertsInRange, getMemberPlaces, type AlertRecord, type MemberPlace } from "../care/api";
import { durationText } from "../care/state";

/**
 * 机构管理者 · 概览（界面稿：机构管理者 · 概览）。
 * 全部数字由客户端用基础数据算出（长者档案、设备在线、按来源查的昨夜睡眠报告、告警记录），不用平台驾驶舱的汇总。
 * 护理区 = 楼栋 + 楼层（平台没有单独的护理区）。界面稿里的"当班"和"到场时间"平台没有数据，改为"平均处理用时"。
 */
type Period = "today" | "week" | "month";

const PERIOD_LABEL: Record<Period, string> = { today: "今天", week: "近 7 天", month: "本月" };

function periodRange(p: Period): [string, string] {
  const end = dayjs();
  const start = p === "today" ? end.startOf("day") : p === "week" ? end.subtract(6, "day").startOf("day") : end.startOf("month");
  const f = "YYYY-MM-DD HH:mm:ss";
  return [start.format(f), end.format(f)];
}

const parse = (t?: string) => (t ? dayjs(t.replace(" ", "T")).valueOf() : NaN);

/** 告警从发生到处理完成的分钟数；未处理返回 undefined */
function handleMinutes(a: AlertRecord) {
  const m = (parse(a.processAt) - parse(a.createdAt)) / 60_000;
  return a.alertStatus === 2 && Number.isFinite(m) && m >= 0 ? m : undefined;
}

function avgText(minutes: number[]) {
  if (!minutes.length) return "—";
  const m = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  return m < 1 ? `${Math.round(m * 60)} 秒` : durationText(m);
}

const areaOf = (x?: { buildingName?: string; floorName?: string }) =>
  x?.buildingName || x?.floorName ? [x.buildingName, x.floorName].filter(Boolean).join(" · ") : "未分配床位";

interface AreaRow {
  key: string;
  elders: number;
  watching: number;
  attention: number;
  alerts: number;
  pending: number;
  handle: number[];
  scores: number[];
}

export default function ManagerHome() {
  const { s, members, attention, sleepReports, alerts: pendingAlerts, liveOf, openElder, process } = useCare();
  const [period, setPeriod] = useState<Period>("today");
  const [places, setPlaces] = useState<MemberPlace[]>();
  const [records, setRecords] = useState<AlertRecord[]>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPlaces(undefined);
    getMemberPlaces().then(
      (x) => !cancelled && setPlaces(x),
      () => !cancelled && setPlaces([]),
    );
    return () => {
      cancelled = true;
    };
  }, [s.orgId, tick]);

  // 告警记录：切换时段、机构，或有告警被处理（待处理数变化）时重新取
  useEffect(() => {
    let cancelled = false;
    setRecords(undefined);
    setError(undefined);
    getAlertsInRange(periodRange(period)).then(
      (x) => !cancelled && setRecords(x),
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [s.orgId, period, pendingAlerts.total, tick]);

  const placeOf = useMemo(() => new Map((places ?? []).map((p) => [p.id, p])), [places]);
  const attentionIds = useMemo(() => new Set(attention.items.map((x) => x.memberId)), [attention]);
  /** 正在监测：至少一台设备在线（实时数据优先，其次是加载时的在线状态） */
  const watching = (m: (typeof members)[number]) => {
    const live = liveOf(m);
    if (live?.online !== undefined) return live.online;
    return !!m.devices?.some((d) => d.isOnline);
  };

  const list = records ?? [];
  const processed = list.filter((a) => a.alertStatus === 2);
  const handleAll = list.map(handleMinutes).filter((x): x is number => x !== undefined);
  const monthStart = dayjs().startOf("month").valueOf();
  // 只算在床位上的长者（与"在院长者"同一口径；档案里还有没分配床位的人）
  const memberIds = new Set(members.map((m) => m.memberId));
  const newThisMonth = (places ?? []).filter((p) => memberIds.has(p.id) && parse(p.checkInAt) >= monthStart).length;
  const watchingCount = members.filter(watching).length;

  // 按护理区（楼栋 · 楼层）汇总
  const rows = useMemo(() => {
    const map = new Map<string, AreaRow>();
    const row = (key: string) => {
      let r = map.get(key);
      if (!r) map.set(key, (r = { key, elders: 0, watching: 0, attention: 0, alerts: 0, pending: 0, handle: [], scores: [] }));
      return r;
    };
    for (const m of members) {
      const r = row(areaOf(placeOf.get(m.memberId)));
      r.elders++;
      if (watching(m)) r.watching++;
      if (attentionIds.has(m.memberId)) r.attention++;
      const score = sleepReports?.get(m.memberId)?.sleepScore;
      if (score !== undefined) r.scores.push(score);
    }
    for (const a of list) {
      const r = row(areaOf(a));
      r.alerts++;
      if (a.alertStatus !== 2) r.pending++;
      const h = handleMinutes(a);
      if (h !== undefined) r.handle.push(h);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key, "zh", { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, placeOf, attentionIds, sleepReports, list, liveOf]);

  // 告警按类型
  const byType = useMemo(() => {
    const m = new Map<string, { name: string; color?: string; total: number; pending: number }>();
    for (const a of list) {
      const t = m.get(a.alertTypeName) ?? { name: a.alertTypeName, color: a.alertTypeColor, total: 0, pending: 0 };
      t.total++;
      if (a.alertStatus !== 2) t.pending++;
      m.set(a.alertTypeName, t);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [list]);

  const columns: TableColumnsType<AreaRow> = [
    { title: "护理区", dataIndex: "key", width: 180, ellipsis: true, render: (v) => <b>{v}</b> },
    { title: "长者", dataIndex: "elders", width: 70, render: (v) => <span className="mono">{v}</span> },
    {
      title: "正在监测",
      key: "watching",
      width: 90,
      render: (_, r) => (
        <span className="mono" style={{ color: r.watching < r.elders ? "#9A5B00" : undefined }}>
          {r.watching}/{r.elders}
        </span>
      ),
    },
    {
      title: "需关注",
      dataIndex: "attention",
      width: 80,
      render: (v: number) => (
        <span className="mono" style={{ color: v ? "#9A5B00" : undefined }}>
          {sleepReports ? v : "…"}
        </span>
      ),
    },
    {
      title: `${PERIOD_LABEL[period]}告警`,
      key: "alerts",
      width: 110,
      render: (_, r) => (
        <span className="mono">
          {records ? r.alerts : "…"}
          {r.pending > 0 && <span style={{ color: "#B4232A" }}> · 未处理 {r.pending}</span>}
        </span>
      ),
    },
    { title: "平均处理用时", key: "handle", width: 110, render: (_, r) => <span className="mono">{records ? avgText(r.handle) : "…"}</span> },
    {
      title: "昨夜平均睡眠分",
      key: "sleep",
      render: (_, r) => {
        if (!sleepReports) return "…";
        if (!r.scores.length) return <span className="muted">无报告</span>;
        const v = Math.round(r.scores.reduce((a, b) => a + b, 0) / r.scores.length);
        return (
          <span className="mgr-bar">
            <span>
              <i style={{ width: `${v}%`, background: v < 65 ? "#F5C26B" : "#8EA0FF" }} />
            </span>
            <span className="mono">{v}</span>
            <span className="muted">{r.scores.length} 份</span>
          </span>
        );
      },
    },
  ];

  const recent = list.slice(0, 12);

  return (
    <div className="page mgr">
      <div className="care-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>{s.orgName}</h1>
          <span className="muted">机构概览 · 数据由客户端按长者档案、设备状态、睡眠报告和告警记录计算</span>
        </div>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Segmented<Period>
            value={period}
            onChange={setPeriod}
            options={(Object.keys(PERIOD_LABEL) as Period[]).map((k) => ({ value: k, label: PERIOD_LABEL[k] }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => setTick((t) => t + 1)} aria-label="刷新" />
        </span>
      </div>

      {error && <Alert type="error" showIcon message={`告警记录加载失败：${error}`} />}

      <div className="mgr-kpis">
        <div className="card kpi">
          <span>在院长者</span>
          <b className="mono">{members.length}</b>
          <small>{places ? `本月新入住 ${newThisMonth} 位` : "…"}</small>
        </div>
        <div className="card kpi">
          <span>正在监测</span>
          <b className="mono">{members.length ? `${Math.round((watchingCount / members.length) * 100)}%` : "—"}</b>
          <small>
            {watchingCount} 位正在监测
            {members.length - watchingCount > 0 && <span style={{ color: "#9A5B00" }}> · {members.length - watchingCount} 位暂停</span>}
          </small>
        </div>
        <div className="card kpi kpi-warn">
          <span>今日需关注</span>
          <b className="mono">{sleepReports ? attention.total : "…"}</b>
          <small>依据昨夜睡眠和未处理的跌倒告警</small>
        </div>
        <div className="card kpi">
          <span>{PERIOD_LABEL[period]}告警</span>
          <b className="mono">{records ? list.length : "…"}</b>
          <small>
            已处理 {processed.length}
            {list.length - processed.length > 0 && <span style={{ color: "#B4232A" }}> · 未处理 {list.length - processed.length}</span>}
          </small>
        </div>
        <div className="card kpi">
          <span>平均处理用时</span>
          <b className="mono">{records ? avgText(handleAll) : "…"}</b>
          <small>从告警发生到处理完成</small>
        </div>
      </div>

      <div className="mgr-grid">
        <section className="card mgr-span2">
          <div className="side-head">
            <h2 style={{ margin: 0, fontSize: 16 }}>各护理区</h2>
            <span className="muted">按楼栋 · 楼层汇总</span>
          </div>
          <Table<AreaRow> rowKey="key" size="small" columns={columns} dataSource={rows} pagination={false} tableLayout="fixed" scroll={{ x: 760 }} />
        </section>

        <section className="card">
          <div className="side-head">
            <h2 style={{ margin: 0, fontSize: 16 }}>需关注长者</h2>
            <span className="muted">{sleepReports ? `共 ${attention.total} 位` : "…"}</span>
          </div>
          {attention.items.length ? (
            <ul className="attention-list">
              {attention.items.slice(0, 8).map((x) => (
                <li key={x.memberId} className="clickable" onClick={() => openElder(x.memberId)}>
                  <span className="avatar">{x.realName.charAt(0)}</span>
                  <span>
                    <b>
                      {x.realName} <span className="muted">{areaOf(placeOf.get(x.memberId))}</span>
                    </b>
                    <small>{x.reasons.join(" · ")}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted">{sleepReports ? "今天没有需要特别关注的长者" : "正在读取昨夜睡眠报告…"}</span>
          )}
        </section>

        <section className="card mgr-span3">
          <div className="side-head">
            <h2 style={{ margin: 0, fontSize: 16 }}>{PERIOD_LABEL[period]}告警处理</h2>
            <span className="muted">处理用时 = 告警发生到在平台上处理完成</span>
          </div>
          {byType.length > 0 && (
            <div className="chips" style={{ marginBottom: 12 }}>
              {byType.map((t) => (
                <span key={t.name} className="chip" style={{ cursor: "default" }}>
                  <i className="mgr-dot" style={{ background: t.color || "#8A8FA8" }} />
                  {t.name} <span className="mono">{t.total}</span>
                  {t.pending > 0 && <span style={{ color: "#B4232A" }}> · 未处理 {t.pending}</span>}
                </span>
              ))}
            </div>
          )}
          {!records ? (
            <span className="muted">正在读取告警记录…</span>
          ) : recent.length ? (
            <div className="mgr-alerts">
              {recent.map((a) => {
                const h = handleMinutes(a);
                const who = a.members?.map((m) => m.realName).join("、") || a.roomName || "未关联长者";
                return (
                  <div key={a.id} className={`mgr-alert${a.alertStatus === 2 ? "" : " pending"}`}>
                    <b style={{ color: a.alertStatus === 2 ? "#3A3F5C" : "#B4232A" }}>{a.alertTypeName}</b>
                    <span>
                      {who} · {areaOf(a)}
                    </span>
                    <span className="muted">
                      <span className="mono">{dayjs(parse(a.createdAt)).format(period === "today" ? "HH:mm" : "MM-DD HH:mm")}</span>
                      {h !== undefined && (
                        <>
                          {" "}
                          · 用时 <span className="mono">{avgText([h])}</span>
                        </>
                      )}
                    </span>
                    {a.alertStatus === 2 ? (
                      <span className="muted">
                        {a.alertProcessTypeName ?? "已处理"}
                        {a.processByUserName ? ` · ${a.processByUserName}` : ""}
                      </span>
                    ) : (
                      <Button size="small" danger onClick={() => process(a)} style={{ alignSelf: "flex-start" }}>
                        去处理
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="muted">{PERIOD_LABEL[period]}没有告警</span>
          )}
          {list.length > recent.length && <div className="muted" style={{ marginTop: 10 }}>只显示最近 {recent.length} 条，完整记录在"告警"模块</div>}
        </section>
      </div>
    </div>
  );
}
