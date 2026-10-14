import { useCallback, useEffect, useState } from "react";
import { Alert, Button, DatePicker, Segmented, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useCare } from "../care/CareContext";
import { ALERT_GROUPS, getAlertPage, type AlertRecord } from "../care/api";
import { alertLocation, sinceText } from "../care/state";

type Status = "pending" | "done" | "all";

/** 告警记录：按类型、状态、时间查询，未处理的可以直接处理 */
export default function AlertsPage() {
  const { s, alerts, members, process, openElder, now } = useCare();
  const [group, setGroup] = useState(ALERT_GROUPS[0].value);
  const [status, setStatus] = useState<Status>("pending");
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(6, "day").startOf("day"), dayjs().endOf("day")]);
  const [page, setPage] = useState({ current: 1, pageSize: 20 });
  const [data, setData] = useState<{ list: AlertRecord[]; total: number }>({ list: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(
        await getAlertPage({
          group,
          status: status === "pending" ? 1 : status === "done" ? 2 : undefined,
          range: [range[0].format("YYYY-MM-DD HH:mm:ss"), range[1].format("YYYY-MM-DD HH:mm:ss")],
          ...page,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [group, status, range, page]);

  // 条件变化、机构切换、或者有新告警 / 告警被处理（待处理总数变化）时重新查询
  useEffect(() => {
    load();
  }, [load, s.orgId, alerts.total]);

  const memberIds = new Set(members.map((m) => m.memberId));

  const columns: TableColumnsType<AlertRecord> = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 170,
      render: (t: string) => (
        <span>
          <span className="mono">{t.slice(5, 16)}</span>
          <br />
          <span className="muted">{sinceText(t, now)}</span>
        </span>
      ),
    },
    {
      title: "类型",
      dataIndex: "alertTypeName",
      width: 130,
      render: (t: string, r) => <b style={{ color: r.alertStatus === 1 ? "#B4232A" : undefined }}>{t}</b>,
    },
    {
      title: "长者",
      key: "who",
      width: 160,
      render: (_, r) =>
        r.members?.length ? (
          r.members.map((m) =>
            memberIds.has(m.memberId) ? (
              <a key={m.memberId} onClick={(e) => (e.stopPropagation(), openElder(m.memberId))}>
                {m.realName}
              </a>
            ) : (
              <span key={m.memberId}>{m.realName}</span>
            ),
          )
        ) : (
          <span className="muted">未关联长者</span>
        ),
    },
    { title: "位置", key: "where", render: (_, r) => alertLocation(r) || <span className="muted">未配置</span> },
    {
      title: "处理情况",
      key: "result",
      width: 280,
      render: (_, r) =>
        r.alertStatus === 1 ? (
          <Tag color="error" bordered={false}>
            未处理
          </Tag>
        ) : (
          <span>
            <Tag color="success" bordered={false}>
              {r.alertProcessTypeName ?? "已处理"}
            </Tag>
            <span className="muted">
              {[r.processByUserName, r.processAt?.slice(5, 16)].filter(Boolean).join(" · ")}
            </span>
            {r.processingResults && <div className="alert-result">{r.processingResults}</div>}
          </span>
        ),
    },
    {
      title: "",
      key: "op",
      width: 90,
      render: (_, r) =>
        r.alertStatus === 1 ? (
          <Button size="small" type="primary" danger onClick={() => process(r)}>
            处理
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="page">
      <div className="care-head">
        <div>
          <h1>告警</h1>
          <p>
            {s.orgName} · 当前共 {alerts.total} 条待处理
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Segmented
            value={group}
            onChange={(v) => (setGroup(v), setPage((p) => ({ ...p, current: 1 })))}
            options={ALERT_GROUPS}
          />
          <Segmented<Status>
            value={status}
            onChange={(v) => (setStatus(v), setPage((p) => ({ ...p, current: 1 })))}
            options={[
              { value: "pending", label: "未处理" },
              { value: "done", label: "已处理" },
              { value: "all", label: "全部" },
            ]}
          />
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            presets={[
              { label: "今天", value: [dayjs().startOf("day"), dayjs().endOf("day")] },
              { label: "近 7 天", value: [dayjs().subtract(6, "day").startOf("day"), dayjs().endOf("day")] },
              { label: "近 30 天", value: [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")] },
            ]}
            onChange={(v) => {
              if (v?.[0] && v[1]) {
                setRange([v[0].startOf("day"), v[1].endOf("day")]);
                setPage((p) => ({ ...p, current: 1 }));
              }
            }}
          />
        </div>
      </div>
      {error && <Alert type="error" showIcon message={`查询告警失败：${error}`} />}
      <div className="card" style={{ padding: 0 }}>
        <Table<AlertRecord>
          rowKey="id"
          columns={columns}
          dataSource={data.list}
          loading={loading}
          scroll={{ x: 1000 }}
          pagination={{
            ...page,
            total: data.total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (current, pageSize) => setPage({ current, pageSize }),
          }}
        />
      </div>
    </div>
  );
}
