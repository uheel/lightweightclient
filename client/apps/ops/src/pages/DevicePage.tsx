import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Col, Form, Input, Row, Select, Statistic, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import {
  getDevicePages,
  getDeviceStatistics,
  getDeviceTypeMap,
  type Device,
  type DeviceQuery,
  type DeviceStatistics,
} from "../api/device";

type Filters = Omit<DeviceQuery, "current" | "pageSize">;

export default function DevicePage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ deviceName?: string; sn?: string; online?: "1" | "0" }>();
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState({ current: 1, pageSize: 20 });
  const [data, setData] = useState<{ list: Device[]; total: number }>({ list: [], total: 0 });
  const [stats, setStats] = useState<DeviceStatistics>();
  const [types, setTypes] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pages, st] = await Promise.all([getDevicePages({ ...page, ...filters }), getDeviceStatistics()]);
      setData(pages);
      setStats(st);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [page, filters, message]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getDeviceTypeMap().then(setTypes, () => {});
  }, []);

  function onSearch() {
    const v = form.getFieldsValue();
    setFilters({
      deviceName: v.deviceName?.trim() || undefined,
      sn: v.sn?.trim() || undefined,
      isOnline: v.online === undefined ? undefined : v.online === "1",
    });
    setPage((p) => ({ ...p, current: 1 }));
  }

  function onReset() {
    form.resetFields();
    setFilters({});
    setPage((p) => ({ ...p, current: 1 }));
  }

  const columns: TableColumnsType<Device> = [
    { title: "设备名称", dataIndex: "deviceName", ellipsis: true },
    { title: "SN", dataIndex: "sn", width: 170, render: (v) => <span className="mono">{v}</span> },
    {
      title: "设备类型",
      width: 160,
      ellipsis: true,
      render: (_, r) => {
        const code = r.deviceTypeCode ?? r.deviceType;
        return r.deviceTypeName ?? (code !== undefined ? (types.get(code) ?? code) : "-");
      },
    },
    { title: "所属机构", dataIndex: "orgName", width: 180, ellipsis: true },
    { title: "固件版本", dataIndex: "firmwareVersion", width: 140, ellipsis: true },
    {
      title: "状态",
      width: 140,
      render: (_, r) => (
        <>
          {r.isOnline ? <Tag color="success">在线</Tag> : <Tag>离线</Tag>}
          {r.isDisabled && <Tag color="error">停用</Tag>}
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <Row gutter={16}>
        <Col span={8}>
          <Card size="small">
            <Statistic title="设备总数" value={stats?.totalCount ?? "-"} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="在线" value={stats?.onlineCount ?? "-"} valueStyle={{ color: "#52c41a" }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="离线" value={stats?.offlineCount ?? "-"} valueStyle={{ color: "#8c8c8c" }} />
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Form form={form} layout="inline" onFinish={onSearch}>
          <Form.Item name="deviceName" label="设备名称">
            <Input allowClear placeholder="模糊查询" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="sn" label="SN">
            <Input allowClear style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="online" label="状态">
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 110 }}
              options={[
                { label: "在线", value: "1" },
                { label: "离线", value: "0" },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
              查询
            </Button>
          </Form.Item>
          <Form.Item>
            <Button onClick={onReset}>重置</Button>
          </Form.Item>
        </Form>
      </Card>

      <Card
        size="small"
        title="设备列表"
        extra={<Button type="text" icon={<ReloadOutlined />} onClick={load} title="刷新" />}
        className="table-card"
      >
        <Table<Device>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={data.list}
          scroll={{ x: 960 }}
          pagination={{
            ...page,
            total: data.total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (current, pageSize) => setPage({ current, pageSize }),
          }}
        />
      </Card>
    </div>
  );
}
