import { useCallback, useEffect, useState } from "react";
import { App, Button, DatePicker, Segmented, Select, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { ALERT_GROUPS, getAlertPage, type OpsAlert } from "../api/device";

const FMT = "YYYY-MM-DD HH:mm:ss";

/** 告警查询（只读）。运维默认看设备离线、安装姿态两类 */
export default function AlertsPage() {
  const { message } = App.useApp();
  const [group, setGroup] = useState(3);
  const [status, setStatus] = useState<1 | 2 | undefined>(1);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [page, setPage] = useState({ current: 1, pageSize: 50 });
  const [data, setData] = useState<{ list: OpsAlert[]; total: number }>({ list: [], total: 0 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await getAlertPage({
          group,
          status,
          range: range ? [range[0].format(FMT), range[1].format(FMT)] : undefined,
          ...page,
        }),
      );
    } catch (e) {
      message.error(`查询告警失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [group, status, range, page, message]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = () => setPage((p) => ({ ...p, current: 1 }));

  const columns: TableColumnsType<OpsAlert> = [
    { title: "时间", dataIndex: "createdAt", width: 160, render: (v) => <span className="mono">{v}</span> },
    { title: "告警", dataIndex: "alertTypeName", width: 160, ellipsis: true },
    { title: "设备", width: 220, ellipsis: true, render: (_, r) => [r.deviceName, r.sn].filter(Boolean).join(" · ") || "—" },
    { title: "位置", ellipsis: true, render: (_, r) => [r.buildingName, r.floorName, r.roomName].filter(Boolean).join(" / ") || "—" },
    {
      title: "状态",
      width: 80,
      render: (_, r) => (r.alertStatus === 1 ? <Tag color="error">未处理</Tag> : <Tag>已处理</Tag>),
    },
    {
      title: "处理",
      width: 220,
      ellipsis: true,
      render: (_, r) =>
        r.alertStatus === 2 ? [r.alertProcessTypeName, r.processingResults, r.processByUserName].filter(Boolean).join(" · ") : "—",
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>告警</h1>
        <Segmented
          options={ALERT_GROUPS}
          value={group}
          onChange={(v) => {
            setGroup(v as number);
            reset();
          }}
        />
      </div>
      <div className="ops-card">
        <div className="toolbar">
          <Select
            style={{ width: 120 }}
            value={status ?? 0}
            onChange={(v) => {
              setStatus(v === 0 ? undefined : (v as 1 | 2));
              reset();
            }}
            options={[
              { label: "未处理", value: 1 },
              { label: "已处理", value: 2 },
              { label: "全部状态", value: 0 },
            ]}
          />
          <DatePicker.RangePicker
            showTime
            value={range}
            onChange={(v) => {
              setRange(v && v[0] && v[1] ? [v[0], v[1]] : null);
              reset();
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={load} title="刷新" />
          <span className="muted small">告警处理请在网页端进行，这里只查看</span>
        </div>
        <Table<OpsAlert>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={data.list}
          tableLayout="fixed"
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
