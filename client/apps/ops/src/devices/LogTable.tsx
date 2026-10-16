import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App, AutoComplete, Button, DatePicker, Input, Segmented, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { formatBytes, perfLog, perfTimer } from "@radar/core";
import { getAllDeviceLogs, type DeviceLog } from "../api/device";

const FMT = "YYYY-MM-DD HH:mm:ss";

/** 常见的命令，供输入框联想；也可以输入其他命令（包含即匹配） */
const COMMANDS = ["Device.heartbeat", "Device.property", "Device.event", "Device.postevent", "Device.config", "Device.upgrade", "QL_radar_track"].map((value) => ({ value }));

const DIRECTIONS = [
  { label: "全部", value: 0 },
  { label: "上报", value: 1 },
  { label: "下发", value: 2 },
];

const PRESETS: { label: string; value: () => [Dayjs, Dayjs] }[] = [
  { label: "最近 1 小时", value: () => [dayjs().subtract(1, "hour"), dayjs()] },
  { label: "最近 6 小时", value: () => [dayjs().subtract(6, "hour"), dayjs()] },
  { label: "今天", value: () => [dayjs().startOf("day"), dayjs().endOf("day")] },
  { label: "昨天", value: () => [dayjs().subtract(1, "day").startOf("day"), dayjs().subtract(1, "day").endOf("day")] },
  { label: "最近 3 天", value: () => [dayjs().subtract(2, "day").startOf("day"), dayjs().endOf("day")] },
];

/**
 * 平台只负责按设备和时间范围取原始日志；方向、命令、消息内容的筛选和分页都在客户端做。
 * 一台设备一天约 3000 条，超过上限时只取最新的这些，并提示缩小时间范围。
 */
const FETCH_PAGE = 5000;
const FETCH_MAX = 30000;

function pretty(raw?: string) {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** 关键字按空格拆开，全部包含才算匹配，不区分大小写 */
function splitTerms(keyword?: string) {
  return (keyword ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 高亮匹配到的关键字 */
function highlight(text: string | undefined, terms: string[]): ReactNode {
  if (!text || !terms.length) return text;
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

/** 消息方向（编号含义待用实际数据核对） */
function directionTag(r: DeviceLog) {
  if (r.direction === 1) return <Tag color="blue">上报</Tag>;
  if (r.direction === 2) return <Tag color="purple">下发</Tag>;
  return r.direction !== undefined ? <Tag>{r.direction}</Tag> : null;
}

interface Query {
  command?: string;
  direction: number;
  keyword?: string;
  range: [Dayjs, Dayjs];
  current: number;
  pageSize: number;
}

/** 一台设备的通信日志表格：按时间、方向、命令和消息内容检索 */
export default function LogTable({ sn }: { sn: string }) {
  const { message } = App.useApp();
  const [command, setCommand] = useState<string>();
  const [direction, setDirection] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf("day"), dayjs().endOf("day")]);
  const [query, setQuery] = useState<Query>({ direction: 0, range, current: 1, pageSize: 50 });
  /** 时间范围内取回的全部日志（未筛选），以及是否被截断 */
  const [all, setAll] = useState<{ key: string; list: DeviceLog[]; truncated: boolean }>();
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const allRef = useRef(all);
  allRef.current = all;

  const terms = useMemo(() => splitTerms(query.keyword), [query.keyword]);
  const from = query.range[0].format(FMT);
  const to = query.range[1].format(FMT);
  const key = `${sn}|${from}|${to}#${tick}`;

  const load = useCallback(async () => {
    // 换筛选条件、翻页时复用已取回的日志，只有设备或时间范围变了、或点刷新才重新取
    if (allRef.current?.key === key) return;
    setLoading(true);
    const pt = perfTimer("通信日志");
    try {
      // 各页并发取（Tauri 里在 Rust 层），比逐页顺序取快一倍左右
      const { list, total, perf } = await getAllDeviceLogs({ sn, range: [from, to], pageSize: FETCH_PAGE, max: FETCH_MAX });
      pt.lap("fetch");
      pt.info("pages", perf?.pages ?? 1);
      pt.info("rows", list.length);
      pt.info("platformTotal", total);
      pt.info("size", formatBytes(perf?.bytes ?? 0));
      setAll({ key, list, truncated: total > list.length });
      pt.endAfterPaint();
    } catch (e) {
      message.error(`查询日志失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [sn, from, to, key, message]);

  useEffect(() => {
    load();
  }, [load]);

  const matched = useMemo(() => {
    if (!all) return [];
    const cmd = query.command?.toLowerCase();
    const t0 = performance.now();
    const out = all.list.filter((r) => {
      if (query.direction && r.direction !== query.direction) return false;
      if (cmd && !(r.command ?? "").toLowerCase().includes(cmd)) return false;
      if (!terms.length) return true;
      const hay = `${r.rawData ?? ""}\n${r.topic ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    perfLog({ label: "通信日志筛选", total: performance.now() - t0, stages: {}, info: { rows: all.list.length, matched: out.length } });
    return out;
  }, [all, query.command, query.direction, terms]);

  const rows = matched.slice((query.current - 1) * query.pageSize, query.current * query.pageSize);
  const filtered = !!(query.command || query.direction || terms.length);

  const search = () =>
    setQuery((q) => ({ ...q, command: command?.trim() || undefined, direction, keyword: keyword.trim() || undefined, range, current: 1 }));
  const refresh = () => setTick((t) => t + 1);

  const columns: TableColumnsType<DeviceLog> = [
    { title: "时间", dataIndex: "createdAt", width: 160, render: (v) => <span className="mono">{v}</span> },
    { title: "方向", width: 64, render: (_, r) => directionTag(r) },
    { title: "命令", dataIndex: "command", width: 170, ellipsis: true, render: (v) => <span className="mono">{v}</span> },
    { title: "消息", dataIndex: "rawData", ellipsis: true, render: (v) => <span className="mono log-raw">{highlight(v, terms)}</span> },
  ];

  return (
    <div className="detail-body">
      <div className="toolbar">
        <DatePicker.RangePicker
          showTime
          value={range}
          presets={PRESETS.map((p) => ({ label: p.label, value: p.value() }))}
          onChange={(v) => v?.[0] && v[1] && setRange([v[0], v[1]])}
          allowClear={false}
        />
        <Segmented options={DIRECTIONS} value={direction} onChange={(v) => setDirection(v as number)} />
        <AutoComplete
          allowClear
          options={COMMANDS}
          value={command}
          onChange={setCommand}
          placeholder="命令，如 Device.heartbeat"
          style={{ width: 200 }}
          filterOption={(input, o) => (o?.value ?? "").toLowerCase().includes(input.toLowerCase())}
        />
        <Input
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={search}
          placeholder="消息内容，如 install，空格分隔多个"
          style={{ width: 260 }}
        />
        <Button type="primary" onClick={search}>
          查询
        </Button>
        <Button icon={<ReloadOutlined />} onClick={refresh} title="刷新" />
        <span className="muted small">
          {all?.truncated ? `时间范围内日志太多，只取了最新的 ${all.list.length} 条，请缩小时间范围` : "点击一行展开完整消息"}
        </span>
      </div>
      <Table<DeviceLog>
        rowKey={(r, i) => r.id ?? `${r.createdAt}-${i}`}
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
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
              <pre>{highlight(pretty(r.rawData), terms)}</pre>
            </div>
          ),
        }}
        pagination={{
          current: query.current,
          pageSize: query.pageSize,
          total: matched.length,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200],
          showTotal: (t) => (filtered ? `匹配 ${t} 条 / 共 ${all?.list.length ?? 0} 条` : `共 ${t} 条`),
          onChange: (current, pageSize) => setQuery((q) => ({ ...q, current, pageSize })),
        }}
      />
    </div>
  );
}
