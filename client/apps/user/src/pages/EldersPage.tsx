import { useEffect, useMemo, useState } from "react";
import { Alert, Input, Segmented, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useCare } from "../care/CareContext";
import { careState, TONE_STYLE, type CareState } from "../care/state";
import { ATTENTION_REASON, type Member } from "../care/api";
import dayjs from "dayjs";
import { getOrgSleepReports, scoreLevel, type SleepReport } from "../care/health";

type Row = { m: Member; st: CareState; report?: SleepReport; reasons: string[] };
type Filter = "all" | "attention" | "bed" | "away" | "paused";

/** 长者列表：所有长者一览，点一行进入详情 */
export default function EldersPage() {
  const { s, members, liveOf, alertByMember, attention, loading, error, now, openElder } = useCare();
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [reports, setReports] = useState<Map<string, SleepReport>>();

  // 昨夜睡眠评分：按每位长者的设备来源查询（与健康页共用缓存）
  useEffect(() => {
    if (!members.length) return;
    let cancelled = false;
    getOrgSleepReports(s.orgId, members, dayjs().format("YYYY-MM-DD")).then(
      (list) => !cancelled && setReports(new Map(list.map((x) => [x.memberId, x]))),
      () => !cancelled && setReports(new Map()),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.orgId, members.length]);

  const rows: Row[] = useMemo(
    () =>
      members.map((m) => {
        const att = attention.items.find((a) => a.memberId === m.memberId);
        return {
          m,
          st: careState(m, liveOf(m), alertByMember[m.memberId], now),
          report: reports?.get(m.memberId),
          reasons: (att?.attentionReasons ?? []).map((r) => ATTENTION_REASON[r] ?? r),
        };
      }),
    [members, liveOf, alertByMember, now, reports, attention.items],
  );

  const kw = keyword.trim();
  const visible = rows.filter((r) => {
    if (kw && !`${r.m.realName}${r.m.bedName ?? ""}`.includes(kw)) return false;
    switch (filter) {
      case "attention":
        return r.st.tone === "alert" || r.st.tone === "warn" || r.m.focusLevel === 1 || r.reasons.length > 0;
      case "bed":
        return r.st.tone === "bed";
      case "away":
        return r.st.tone === "idle";
      case "paused":
        return r.st.tone === "unknown";
      default:
        return true;
    }
  });

  const columns: TableColumnsType<Row> = [
    {
      title: "长者",
      key: "name",
      width: 220,
      ellipsis: true,
      sorter: (a, b) => a.m.realName.localeCompare(b.m.realName, "zh"),
      render: (_, r) => (
        <span className="cell-who">
          <span className="elder-avatar small" style={{ background: TONE_STYLE[r.st.tone].bg, color: TONE_STYLE[r.st.tone].color }}>
            {r.m.realName.charAt(0)}
          </span>
          <span>
            <b>{r.m.realName}</b>
            {r.m.focusLevel === 1 && <span className="focus-tag">重点关注</span>}
          </span>
        </span>
      ),
    },
    { title: "年龄", key: "age", width: 80, sorter: (a, b) => (a.m.age ?? 0) - (b.m.age ?? 0), render: (_, r) => (r.m.age ? `${r.m.age} 岁` : "—") },
    {
      title: "床位",
      key: "bed",
      width: 140,
      defaultSortOrder: "ascend",
      sorter: (a, b) => (a.m.bedName ?? "").localeCompare(b.m.bedName ?? "", "zh"),
      render: (_, r) => r.m.bedName ?? "未分配",
    },
    {
      title: "现在",
      key: "state",
      width: 220,
      ellipsis: true,
      render: (_, r) => (
        <span>
          <b style={{ color: TONE_STYLE[r.st.tone].color }}>{r.st.text}</b>
          {r.st.detail && <span className="muted"> · {r.st.detail}</span>}
        </span>
      ),
    },
    {
      title: "心率 / 呼吸",
      key: "vitals",
      width: 120,
      render: (_, r) => {
        const l = liveOf(r.m);
        return r.st.tone === "bed" && (l?.heartRate || l?.respiratoryRate) ? (
          <span className="mono">
            {l?.heartRate ?? "—"} / {l?.respiratoryRate ?? "—"}
          </span>
        ) : (
          <span className="muted">—</span>
        );
      },
    },
    {
      title: "昨夜睡眠",
      key: "sleep",
      width: 130,
      sorter: (a, b) => (a.report?.sleepScore ?? 999) - (b.report?.sleepScore ?? 999),
      render: (_, r) => {
        if (!reports) return <span className="muted">查询中…</span>;
        if (!r.report?.sleepScore) return <span className="muted">—</span>;
        const lv = scoreLevel(r.report.sleepScore);
        return (
          <span>
            <b className="mono" style={{ color: lv.color }}>
              {r.report.sleepScore}
            </b>
            <span className="muted"> {lv.text}</span>
          </span>
        );
      },
    },
    {
      title: "需关注",
      key: "reasons",
      width: 300,
      render: (_, r) =>
        r.reasons.length ? (
          r.reasons.map((t) => (
            <Tag key={t} color="orange" bordered={false}>
              {t}
            </Tag>
          ))
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];

  return (
    <div className="page">
      <div className="care-head">
        <div>
          <h1>长者</h1>
          <p>
            {s.orgName} · 共 {members.length} 位，点任意一行查看详情
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="姓名或床位"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 200 }}
          />
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "全部" },
              { value: "attention", label: "需关注" },
              { value: "bed", label: "在床" },
              { value: "away", label: "离床 / 不在" },
              { value: "paused", label: "暂停监测" },
            ]}
          />
        </div>
      </div>
      {error && <Alert type="error" showIcon message={`加载长者列表失败：${error}`} />}
      <div className="card" style={{ padding: 0 }}>
        <Table<Row>
          rowKey={(r) => r.m.memberId}
          columns={columns}
          dataSource={visible}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 位` }}
          onRow={(r) => ({ onClick: () => openElder(r.m.memberId), style: { cursor: "pointer" } })}
          tableLayout="fixed"
          scroll={{ x: 1300 }}
        />
      </div>
    </div>
  );
}
