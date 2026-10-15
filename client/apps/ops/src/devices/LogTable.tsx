import { useCallback, useEffect, useState } from "react";
import { App, AutoComplete, Button, DatePicker, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { getDeviceLogs, type DeviceLog } from "../api/device";

const FMT = "YYYY-MM-DD HH:mm:ss";

/** 常见的命令，供输入框联想；也可以输入其他命令 */
const COMMANDS = ["Device.heartbeat", "Device.property", "Device.event", "Device.config", "Device.upgrade", "QL_radar_track"].map((value) => ({ value }));

function pretty(raw?: string) {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** 消息方向（编号含义待用实际数据核对） */
function directionTag(r: DeviceLog) {
  if (r.direction === 1) return <Tag color="blue">上报</Tag>;
  if (r.direction === 2) return <Tag color="purple">下发</Tag>;
  return r.direction !== undefined ? <Tag>{r.direction}</Tag> : null;
}

/** 一台设备的通信日志表格 */
export default function LogTable({ sn, compact }: { sn: string; compact?: boolean }) {
  const { message } = App.useApp();
  const [command, setCommand] = useState<string>();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf("day"), dayjs().endOf("day")]);
  const [query, setQuery] = useState({ command: undefined as string | undefined, range, current: 1, pageSize: 50 });
  const [data, setData] = useState<{ list: DeviceLog[]; total: number }>({ list: [], total: 0 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await getDeviceLogs({
          sn,
          command: query.command,
          range: [query.range[0].format(FMT), query.range[1].format(FMT)],
          current: query.current,
          pageSize: query.pageSize,
        }),
      );
    } catch (e) {
      message.error(`查询日志失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [sn, query, message]);

  useEffect(() => {
    load();
  }, [load]);

  const search = () => setQuery((q) => ({ ...q, command: command?.trim() || undefined, range, current: 1 }));

  const columns: TableColumnsType<DeviceLog> = [
    { title: "时间", dataIndex: "createdAt", width: 160, render: (v) => <span className="mono">{v}</span> },
    { title: "方向", width: 64, render: (_, r) => directionTag(r) },
    { title: "命令", dataIndex: "command", width: 170, ellipsis: true, render: (v) => <span className="mono">{v}</span> },
    { title: "消息", dataIndex: "rawData", ellipsis: true, render: (v) => <span className="mono log-raw">{v}</span> },
  ];

  return (
    <div className={compact ? "detail-body" : "log-panel"}>
      <div className="toolbar">
        <AutoComplete
          allowClear
          options={COMMANDS}
          value={command}
          onChange={setCommand}
          placeholder="命令，如 Device.heartbeat"
          style={{ width: 220 }}
          filterOption={(input, o) => (o?.value ?? "").toLowerCase().includes(input.toLowerCase())}
        />
        <DatePicker.RangePicker
          showTime
          value={range}
          onChange={(v) => v?.[0] && v[1] && setRange([v[0], v[1]])}
          allowClear={false}
        />
        <Button type="primary" onClick={search}>
          查询
        </Button>
        <Button icon={<ReloadOutlined />} onClick={load} title="刷新" />
        <span className="muted small">点击一行展开完整消息</span>
      </div>
      <Table<DeviceLog>
        rowKey={(r, i) => r.id ?? `${r.createdAt}-${i}`}
        size="small"
        loading={loading}
        columns={columns}
        dataSource={data.list}
        tableLayout="fixed"
        expandable={{
          expandRowByClick: true,
          expandedRowRender: (r) => (
            <div className="log-expand">
              {r.topic && (
                <div className="muted small">
                  Topic <span className="mono">{r.topic}</span>
                </div>
              )}
              <pre>{pretty(r.rawData)}</pre>
            </div>
          ),
        }}
        pagination={{
          current: query.current,
          pageSize: query.pageSize,
          total: data.total,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (current, pageSize) => setQuery((q) => ({ ...q, current, pageSize })),
        }}
      />
    </div>
  );
}
