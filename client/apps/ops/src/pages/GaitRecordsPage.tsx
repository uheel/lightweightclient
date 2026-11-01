import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, Select, Spin, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, FileTextOutlined, ReloadOutlined, SearchOutlined, SyncOutlined } from "@ant-design/icons";
import { hasPermission, perfTimer, session } from "@radar/core";
import { deleteSegment, getGaitSegments, getSegmentMembers, regenerateSegment, type GaitSegment, type SegmentMember } from "../api/gait";
import { ReportView } from "../gait/ReportView";
import "../gait/gait.css";
import { ModuleName } from "../workspace/ModuleName";
import { useRefreshOn, type Topic } from "../workspace/dataChange";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const GENDER: Record<number, string> = { 1: "男", 2: "女" };
const RISK_COLOR: Record<number, string> = { 1: "success", 2: "warning", 3: "error" };
const REFRESH_ON: Topic[] = ["member", "device"];

/** 从传感器、用户跳过来时带的筛选；seq 让同样的筛选能再跳一次 */
export interface RecordFocus {
  memberId?: string;
  sn?: string;
  seq: number;
}

type Risk = "all" | "1" | "2" | "3" | "none";
const RISK_OPTIONS: { value: Risk; label: string }[] = [
  { value: "all", label: "全部风险" },
  { value: "1", label: "低风险" },
  { value: "2", label: "中风险" },
  { value: "3", label: "高风险" },
  { value: "none", label: "未评估" },
];

const riskText = (r: GaitSegment) => r.fallRiskTypeDsp || (r.fallRiskType === 1 ? "低风险" : r.fallRiskType === 2 ? "中风险" : r.fallRiskType === 3 ? "高风险" : "");

/**
 * 采集记录：左边按用户分组，右边记录表；点一条打开报告（模块内全屏，运维端不开子标签）。
 * 进页面一次取回全部记录，分组、筛选、搜索、分页都在本地算，只有增删和刷新才请求平台。
 */
export default function GaitRecordsPage({ focus }: { focus?: RecordFocus }) {
  const { message, modal } = App.useApp();
  const s = session.get();
  const can = (a: "update" | "delete") => !!s && hasPermission(s, `GAIT_COLLECTION_RECORD:${a}`);
  const [rows, setRows] = useState<GaitSegment[]>([]);
  const [people, setPeople] = useState<Map<string, SegmentMember>>(new Map());
  const [loading, setLoading] = useState(true);
  const [memberId, setMemberId] = useState<string>();
  const [memberQ, setMemberQ] = useState("");
  const [q, setQ] = useState("");
  const [sn, setSn] = useState<string>();
  const [risk, setRisk] = useState<Risk>("all");
  const [report, setReport] = useState<GaitSegment>();
  const [busy, setBusy] = useState<string>();
  const seq = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      const my = ++seq.current;
      if (!quiet) setLoading(true);
      const pt = perfTimer("步态采集记录");
      try {
        const [list, ms] = await Promise.all([getGaitSegments(), getSegmentMembers().catch(() => [] as SegmentMember[])]);
        if (my !== seq.current) return;
        setRows([...list].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
        setPeople(new Map(ms.map((m) => [m.memberId, m])));
        pt.info("segments", list.length);
        pt.endAfterPaint();
      } catch (e) {
        message.error(`加载失败：${errText(e)}`);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [message],
  );
  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    load();
  }, [load]);
  useRefreshOn(REFRESH_ON, refresh);

  useEffect(() => {
    if (!focus) return;
    setMemberId(focus.memberId);
    setSn(focus.sn);
    setQ("");
    setMemberQ("");
    setRisk("all");
    setReport(undefined);
  }, [focus]);

  /** 左边的用户：按记录算条数，最近采集的排前面 */
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number; last: string }>();
    for (const r of rows) {
      if (!r.memberId) continue;
      const g = m.get(r.memberId);
      if (g) {
        g.count++;
        if ((r.createdAt ?? "") > g.last) g.last = r.createdAt ?? "";
      } else m.set(r.memberId, { id: r.memberId, name: r.memberName || people.get(r.memberId)?.realName || "未命名用户", count: 1, last: r.createdAt ?? "" });
    }
    return [...m.values()].sort((a, b) => b.last.localeCompare(a.last));
  }, [rows, people]);

  const shownGroups = useMemo(() => {
    const k = memberQ.trim().toLowerCase();
    return k ? groups.filter((g) => g.name.toLowerCase().includes(k)) : groups;
  }, [groups, memberQ]);

  const devices = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.sn && !m.has(r.sn)) m.set(r.sn, r.deviceName || r.sn);
    return [...m].map(([value, name]) => ({ value, label: `${name} · ${value}` }));
  }, [rows]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!memberId || r.memberId === memberId) &&
        (!sn || r.sn === sn) &&
        (risk === "all" || (risk === "none" ? !r.fallRiskType : String(r.fallRiskType) === risk)) &&
        (!k || [r.title, r.deviceName, r.sn, r.memberName].some((v) => v?.toLowerCase().includes(k))),
    );
  }, [rows, memberId, sn, risk, q]);

  async function regenerate(r: GaitSegment) {
    setBusy(r.id);
    try {
      await regenerateSegment(r.memberId, r.id);
      message.success("报告已重新生成");
      await refresh();
    } catch (e) {
      message.error(`重新生成失败：${errText(e)}`);
    } finally {
      setBusy(undefined);
    }
  }

  function askDelete(r: GaitSegment) {
    modal.confirm({
      title: `删除采集记录 ${r.title ?? ""}？`,
      content: "对应的步态、IMU 数据和报告会一起删除，平台上不能恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteSegment(r.id);
          message.success("已删除");
          setRows((l) => l.filter((x) => x.id !== r.id));
        } catch (e) {
          message.error(`删除失败：${errText(e)}`);
        }
      },
    });
  }

  const columns: ColumnsType<GaitSegment> = [
    {
      title: "采集编号",
      dataIndex: "title",
      width: 150,
      render: (v: string | undefined, r) => (
        <a
          onClick={(e) => {
            e.stopPropagation();
            setReport(r);
          }}
        >
          {v || r.id.slice(0, 8)}
        </a>
      ),
    },
    { title: "用户", dataIndex: "memberName", width: 130, ellipsis: true, render: (v?: string) => v || "-" },
    { title: "设备", dataIndex: "deviceName", ellipsis: true, render: (v: string | undefined, r) => <Tooltip title={r.sn}>{v || r.sn || "-"}</Tooltip> },
    { title: "时长", dataIndex: "duration", width: 80, sorter: (a, b) => (a.duration ?? 0) - (b.duration ?? 0), render: (v?: number) => (v != null ? `${v} 秒` : "-") },
    {
      title: "跌倒风险",
      dataIndex: "fallRiskType",
      width: 130,
      render: (t: number | undefined, r) =>
        riskText(r) ? (
          <span>
            <Tag color={t ? RISK_COLOR[t] : undefined}>{riskText(r)}</Tag>
            {r.fallRiskScore != null && <span className="muted small">{r.fallRiskScore} 分</span>}
          </span>
        ) : (
          <span className="muted">未评估</span>
        ),
    },
    { title: "采集时间", dataIndex: "createdAt", width: 170, sorter: (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""), defaultSortOrder: undefined },
    {
      title: "操作",
      key: "op",
      width: 112,
      render: (_, r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button type="text" size="small" icon={<FileTextOutlined />} title="查看报告" onClick={() => setReport(r)} />
          {can("update") && <Button type="text" size="small" icon={<SyncOutlined />} title="重新生成报告" loading={busy === r.id} disabled={!r.memberId} onClick={() => regenerate(r)} />}
          {can("delete") && <Button type="text" size="small" danger icon={<DeleteOutlined />} title="删除采集记录" onClick={() => askDelete(r)} />}
        </span>
      ),
    },
  ];

  const person = memberId ? people.get(memberId) : undefined;

  return (
    <div className="workbench gait-records">
      {report && <ReportView key={report.id} segmentId={report.id} reportNo={report.title} onBack={() => setReport(undefined)} />}
      <section className="dev-list" style={{ width: 260 }} hidden={!!report}>
        <div className="dev-list-head">
          <div className="dev-list-title">
            <h1>
              <ModuleName k="gaitRecords" />
            </h1>
            <span className="muted">{rows.length} 条</span>
            <span style={{ flex: 1 }} />
            <Button type="text" icon={<ReloadOutlined />} loading={loading} onClick={() => load()} title="刷新" />
          </div>
          <Input allowClear prefix={<SearchOutlined style={{ color: "#8A8FA8" }} />} placeholder="搜索用户" value={memberQ} onChange={(e) => setMemberQ(e.target.value)} />
        </div>
        <div className="dev-rows" role="listbox" aria-label="用户">
          {loading && !rows.length ? (
            <Spin style={{ margin: 40 }} />
          ) : (
            <>
              <div role="option" aria-selected={!memberId} className={`dev-row${!memberId ? " on" : ""}`} onClick={() => setMemberId(undefined)}>
                <span className="dev-row-main">
                  <b>全部用户</b>
                </span>
                <span className="dev-row-last">{rows.length} 条</span>
              </div>
              {shownGroups.map((g) => {
                const info = people.get(g.id);
                return (
                  <div key={g.id} role="option" aria-selected={g.id === memberId} className={`dev-row${g.id === memberId ? " on" : ""}`} onClick={() => setMemberId(g.id)}>
                    <span className="dev-row-main">
                      <b>{g.name}</b>
                      <small>{[info?.gender ? GENDER[info.gender] : undefined, info?.age ? `${info.age} 岁` : undefined, g.last.slice(0, 10)].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className="dev-row-last">{g.count} 条</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </section>
      <section className="dev-detail gait-records-main" hidden={!!report}>
        <div className="gait-records-tools">
          <b>{memberId ? (person?.realName ?? groups.find((g) => g.id === memberId)?.name ?? "用户") : "全部用户"}</b>
          <span className="muted small">
            显示 {shown.length} / {rows.length}
          </span>
          <span style={{ flex: 1 }} />
          <Input allowClear style={{ width: 200 }} prefix={<SearchOutlined style={{ color: "#8A8FA8" }} />} placeholder="编号 / 设备 / SN" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select allowClear showSearch optionFilterProp="label" style={{ width: 220 }} placeholder="全部设备" value={sn} onChange={setSn} options={devices} />
          <Select style={{ width: 110 }} value={risk} onChange={setRisk} options={RISK_OPTIONS} />
        </div>
        {!loading && !rows.length ? (
          <Empty style={{ marginTop: 120 }} description="这个机构还没有采集记录" />
        ) : (
          <Table<GaitSegment>
            size="small"
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={shown}
            onRow={(r) => ({ onClick: () => setReport(r), style: { cursor: "pointer" } })}
            pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100], hideOnSinglePage: true, showTotal: (t) => `共 ${t} 条` }}
            locale={{ emptyText: "没有符合条件的记录" }}
          />
        )}
      </section>
    </div>
  );
}
