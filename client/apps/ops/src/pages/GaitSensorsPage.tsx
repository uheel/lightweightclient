import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Form, Input, InputNumber, Modal, Select, Spin, Table, Tabs, Tag } from "antd";
import { DeleteOutlined, DisconnectOutlined, EditOutlined, LinkOutlined, PlusOutlined, ProfileOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { hasPermission, perfTimer, session } from "@radar/core";
import {
  bindGaitSensor,
  createGaitSensor,
  deleteGaitSensor,
  getActivityTime,
  getBindOptions,
  getGaitSensors,
  getSensorFalls,
  getSensorStatus,
  unbindGaitSensor,
  updateGaitSensor,
  type BindOption,
  type GaitSensor,
  type SensorFallRow,
  type SensorForm,
  type SensorStatusRow,
} from "../api/gait";
import PropertyTab from "../devices/PropertyTab";
import { sensorLink, SENSOR_LINK_TEXT, type SensorLink } from "../gait/reportModel";
import "../gait/gait.css";
import { moduleAllowed } from "../workspace/modules";
import { ModuleName } from "../workspace/ModuleName";
import { useRefreshOn, type Topic } from "../workspace/dataChange";
import type { RecordFocus } from "./GaitRecordsPage";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const REFRESH_ON: Topic[] = ["device", "member"];

type Filter = "all" | SensorLink | "unbound";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "online", label: "在线" },
  { key: "stale", label: "过期" },
  { key: "offline", label: "离线" },
  { key: "unbound", label: "未绑定" },
];

const LINK_DOT: Record<SensorLink, string> = { online: "online", stale: "stale", offline: "offline" };

/**
 * 步态传感器：左边列表，右边基本信息、设备属性、跌倒记录、设备状态。
 * 进页面取一次全部传感器，筛选、搜索、统计都在本地算。平台机构下能看到所有机构的传感器。
 */
export default function GaitSensorsPage({ onOpenRecords }: { onOpenRecords: (f: Omit<RecordFocus, "seq">) => void }) {
  const { message, modal } = App.useApp();
  const s = session.get();
  const can = (a: "add" | "update" | "delete") => !!s && hasPermission(s, `GAIT_SENSOR:${a}`);
  const [list, setList] = useState<GaitSensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selId, setSelId] = useState<string>();
  const [form, setForm] = useState<Partial<SensorForm>>();
  const [binding, setBinding] = useState<GaitSensor>();
  const seq = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      const my = ++seq.current;
      if (!quiet) setLoading(true);
      const pt = perfTimer("步态传感器");
      try {
        const rows = await getGaitSensors();
        if (my !== seq.current) return;
        setList(rows);
        pt.info("sensors", rows.length);
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

  const links = useMemo(() => {
    const now = Date.now();
    return new Map(list.map((d) => [d.id, sensorLink(d, now)]));
  }, [list]);
  const crossOrg = useMemo(() => new Set(list.map((d) => d.orgId)).size > 1, [list]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: list.length, online: 0, stale: 0, offline: 0, unbound: 0 };
    for (const d of list) {
      c[links.get(d.id)!]++;
      if (!d.memberId) c.unbound++;
    }
    return c;
  }, [list, links]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return list
      .filter((d) => filter === "all" || (filter === "unbound" ? !d.memberId : links.get(d.id) === filter))
      .filter((d) => !k || [d.deviceName, d.sn, d.identifier, d.realName, d.orgName].some((v) => v?.toLowerCase().includes(k)));
  }, [list, links, q, filter]);

  const sel = list.find((d) => d.id === selId);

  function askDelete(d: GaitSensor) {
    modal.confirm({
      title: `删除传感器"${d.deviceName}"？`,
      content: "从平台上移除这台传感器，平台上不能恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteGaitSensor(d.id);
          message.success("已删除");
          setSelId(undefined);
          setList((l) => l.filter((x) => x.id !== d.id));
        } catch (e) {
          message.error(`删除失败：${errText(e)}`);
        }
      },
    });
  }

  function askUnbind(d: GaitSensor) {
    modal.confirm({
      title: `解除"${d.deviceName}"和${d.realName ?? "用户"}的绑定？`,
      okText: "解绑",
      onOk: async () => {
        try {
          await unbindGaitSensor(d.id, d.memberId);
          message.success("已解绑");
          refresh();
        } catch (e) {
          message.error(`解绑失败：${errText(e)}`);
        }
      },
    });
  }

  return (
    <div className="workbench">
      <section className="dev-list">
        <div className="dev-list-head">
          <div className="dev-list-title">
            <h1>
              <ModuleName k="gaitSensors" />
            </h1>
            <span className="muted">
              {list.length} 台 · {counts.online} 在线
            </span>
            <span style={{ flex: 1 }} />
            <Button type="text" icon={<ReloadOutlined />} loading={loading} onClick={() => load()} title="刷新" />
            {can("add") && <Button type="text" icon={<PlusOutlined />} onClick={() => setForm({})} title="添加传感器" />}
          </div>
          <Input allowClear prefix={<SearchOutlined style={{ color: "#8A8FA8" }} />} placeholder="名称 / SN / 用户 / 机构" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg">
            {FILTERS.map((f) => (
              <button key={f.key} className={f.key === filter ? "on" : ""} onClick={() => setFilter(f.key)}>
                {f.label} <b>{counts[f.key]}</b>
              </button>
            ))}
          </div>
        </div>
        <div className="dev-rows" role="listbox" aria-label="步态传感器">
          {loading && !list.length ? (
            <Spin style={{ margin: 40 }} />
          ) : !shown.length ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={list.length ? "没有符合条件的传感器" : "这个机构还没有步态传感器"} />
          ) : (
            shown.map((d) => {
              const l = links.get(d.id)!;
              return (
                <div key={d.id} role="option" aria-selected={d.id === selId} className={`dev-row${d.id === selId ? " on" : ""}`} onClick={() => setSelId(d.id)}>
                  <i className={`dot ${LINK_DOT[l]}`} title={SENSOR_LINK_TEXT[l]} />
                  <span className="dev-row-main">
                    <b>{d.deviceName}</b>
                    <small>{[d.realName ?? "未绑定用户", crossOrg && d.orgName, d.sn].filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className={`dev-row-last${d.battery != null && d.battery < 20 ? " err-text" : l === "online" ? "" : " off"}`}>{d.battery != null ? `${d.battery}%` : ""}</span>
                </div>
              );
            })
          )}
        </div>
        <div className="dev-list-foot muted">
          显示 {shown.length} / {list.length}
        </div>
      </section>

      <section className="dev-detail">
        {sel ? (
          <SensorDetail
            key={sel.id}
            d={sel}
            link={links.get(sel.id)!}
            canEdit={can("update")}
            canDelete={can("delete")}
            canRecords={moduleAllowed(s, "gaitRecords")}
            onEdit={() => setForm(sel)}
            onDelete={() => askDelete(sel)}
            onBind={() => setBinding(sel)}
            onUnbind={() => askUnbind(sel)}
            onOpenRecords={() => onOpenRecords({ sn: sel.sn })}
          />
        ) : (
          <Empty style={{ marginTop: 120 }} description="选择左侧的传感器" />
        )}
      </section>

      <SensorDialog
        value={form}
        onClose={() => setForm(undefined)}
        onSaved={() => {
          setForm(undefined);
          refresh();
        }}
      />
      <BindDialog
        sensor={binding}
        onClose={() => setBinding(undefined)}
        onDone={() => {
          setBinding(undefined);
          refresh();
        }}
      />
    </div>
  );
}

function SensorDetail({
  d,
  link,
  canEdit,
  canDelete,
  canRecords,
  onEdit,
  onDelete,
  onBind,
  onUnbind,
  onOpenRecords,
}: {
  d: GaitSensor;
  link: SensorLink;
  canEdit: boolean;
  canDelete: boolean;
  canRecords: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onBind: () => void;
  onUnbind: () => void;
  onOpenRecords: () => void;
}) {
  const [tab, setTab] = useState("info");
  const [activity, setActivity] = useState<string>();

  // 列表里的活动时间可能缺，选中时取一次设备真实的最后活动时间
  useEffect(() => {
    let dead = false;
    getActivityTime(d.sn).then(
      (t) => !dead && setActivity(t),
      () => {},
    );
    return () => {
      dead = true;
    };
  }, [d.sn]);

  const last = activity ?? d.lastActivityTime;
  return (
    <div className="detail gait-detail">
      <div className="detail-head">
        <div className="detail-title">
          <i className={`dot ${LINK_DOT[link]}`} />
          <h1>{d.deviceName}</h1>
          <span className={`status-tag ${link === "online" ? "online" : "offline"}`}>{SENSOR_LINK_TEXT[link]}</span>
          <span style={{ flex: 1 }} />
          {canRecords && (
            <Button icon={<ProfileOutlined />} onClick={onOpenRecords}>
              采集记录
            </Button>
          )}
          {canEdit && (
            <Button icon={<EditOutlined />} onClick={onEdit}>
              修改
            </Button>
          )}
          {canDelete && <Button danger icon={<DeleteOutlined />} onClick={onDelete} title="删除传感器" />}
        </div>
        <div className="detail-sub">
          <span>SN {d.sn}</span>
          {d.orgName && <span>{d.orgName}</span>}
          <span>最后活动 {last ?? "没有记录"}</span>
        </div>
        {link === "stale" && <div className="gait-note">平台显示在线，但最后活动已经超过 30 分钟，实际可能已经离线。</div>}
      </div>
      <Tabs
        className="detail-tabs"
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "info",
            label: "基本信息",
            children: (
              <div className="ops-card">
                <dl className="gait-info">
                  <div>
                    <dt>绑定用户</dt>
                    <dd>
                      {d.realName ?? <span className="muted">未绑定</span>}
                      {canEdit &&
                        (d.memberId ? (
                          <Button size="small" type="link" icon={<DisconnectOutlined />} onClick={onUnbind}>
                            解绑
                          </Button>
                        ) : (
                          <Button size="small" type="link" icon={<LinkOutlined />} onClick={onBind}>
                            绑定用户
                          </Button>
                        ))}
                    </dd>
                  </div>
                  <Info k="电量" v={d.battery != null ? `${d.battery}%` : undefined} />
                  <Info k="信号" v={d.rssi != null ? `${d.rssi} dBm` : undefined} />
                  <Info k="Mac / UUID" v={d.identifier} />
                  <Info k="数据集" v={d.datasetCount} />
                  <Info k="排序值" v={d.sortOrder} />
                  <Info k="添加时间" v={d.createdAt} />
                  <Info k="添加人" v={d.createdBy} />
                  <Info k="备注" v={d.description} />
                </dl>
              </div>
            ),
          },
          { key: "props", label: "设备属性", children: <PropertyTab sn={d.sn} online={link === "online"} /> },
          { key: "falls", label: "跌倒记录", children: <FallTab deviceId={d.id} /> },
          { key: "status", label: "设备状态", children: <StatusTab deviceId={d.id} /> },
        ]}
      />
    </div>
  );
}

function Info({ k, v }: { k: string; v: string | number | undefined }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v ?? <span className="muted">-</span>}</dd>
    </div>
  );
}

const FALL_TYPE: Record<number, { text: string; color?: string }> = { 0: { text: "未知" }, 1: { text: "跌倒", color: "red" }, 2: { text: "疑似跌倒", color: "orange" } };

function FallTab({ deviceId }: { deviceId: string }) {
  const [rows, setRows] = useState<SensorFallRow[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    getSensorFalls(deviceId).then(setRows, (e) => setError(errText(e)));
  }, [deviceId]);
  if (error) return <div className="err-text">加载失败：{error}</div>;
  return (
    <Table<SensorFallRow>
      size="small"
      rowKey={(r) => `${r.createdAt}-${r.deviceTime}`}
      loading={!rows}
      dataSource={rows}
      pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
      locale={{ emptyText: "没有跌倒记录" }}
      columns={[
        { title: "记录时间", dataIndex: "createdAt", width: 180 },
        { title: "设备时间", dataIndex: "deviceTime", width: 180 },
        {
          title: "类型",
          dataIndex: "type",
          render: (t: number) => {
            const x = FALL_TYPE[t] ?? FALL_TYPE[0];
            return <Tag color={x.color}>{x.text}</Tag>;
          },
        },
      ]}
    />
  );
}

function StatusTab({ deviceId }: { deviceId: string }) {
  const [data, setData] = useState<{ rows: SensorStatusRow[]; total: number }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    getSensorStatus(deviceId).then(setData, (e) => setError(errText(e)));
  }, [deviceId]);
  if (error) return <div className="err-text">加载失败：{error}</div>;
  return (
    <>
      {!!data && data.total > data.rows.length && <div className="muted small" style={{ marginBottom: 8 }}>共 {data.total} 条，这里显示最新的 {data.rows.length} 条</div>}
      <Table<SensorStatusRow>
        size="small"
        rowKey={(r, i) => `${r.createdAt}-${i}`}
        loading={!data}
        dataSource={data?.rows}
        scroll={{ x: 900 }}
        pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
        locale={{ emptyText: "没有设备状态记录" }}
        columns={[
          { title: "时间", dataIndex: "createdAt", width: 170 },
          { title: "角色", dataIndex: "role", width: 70 },
          { title: "电量", dataIndex: "battery", width: 70, render: (v?: number) => (v != null ? `${v}%` : "-") },
          { title: "电压", dataIndex: "voltage", width: 90, render: (v?: number) => (v ? `${v} mV` : "-") },
          { title: "状态", dataIndex: "status", width: 80 },
          { title: "开机时间", dataIndex: "uptime", width: 100 },
          { title: "手机信号", dataIndex: "phoneRssi", width: 80 },
          { title: "主设备信号", dataIndex: "masterRssi", width: 90 },
          { title: "从设备信号", dataIndex: "slaveRssi", width: 90 },
          { title: "版本", dataIndex: "version", width: 100 },
          { title: "从设备 MAC", dataIndex: "slaveMac", width: 150 },
        ]}
      />
    </>
  );
}

function SensorDialog({ value, onClose, onSaved }: { value?: Partial<SensorForm>; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<SensorForm>();
  const [saving, setSaving] = useState(false);
  const open = !!value;
  const editing = !!value?.id;

  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    try {
      if (value?.id) await updateGaitSensor({ ...v, id: value.id });
      else await createGaitSensor(v);
      message.success(editing ? "已保存" : "已添加");
      onSaved();
    } catch (e) {
      message.error(`保存失败：${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={editing ? "修改传感器" : "添加步态传感器"} okText="保存" confirmLoading={saving} onOk={submit} onCancel={onClose} destroyOnHidden>
      {/* 弹窗关闭时销毁，每次打开都重新挂载，初始值放这里（表单挂载比 effect 晚，setFieldsValue 赋不上） */}
      <Form form={form} layout="vertical" preserve={false} initialValues={{ sortOrder: 0, ...value }}>
        <Form.Item name="deviceName" label="设备名称" rules={[{ required: true, whitespace: true, message: "填设备名称" }]}>
          <Input maxLength={64} />
        </Form.Item>
        <Form.Item name="sn" label="SN" extra="全平台唯一，通常是去掉冒号的 MAC 地址" rules={[{ required: true, whitespace: true, message: "填 SN" }]}>
          <Input maxLength={32} disabled={editing} />
        </Form.Item>
        <Form.Item name="sortOrder" label="排序值">
          <InputNumber style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="description" label="备注">
          <Input.TextArea rows={2} maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

const optionLabel = (o: BindOption) => [o.realName, o.age ? `${o.age} 岁` : undefined, [o.buildingName, o.floorName, o.roomName, o.bedName].filter(Boolean).join("-")].filter(Boolean).join(" · ");

function BindDialog({ sensor, onClose, onDone }: { sensor?: GaitSensor; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [options, setOptions] = useState<BindOption[]>();
  const [memberId, setMemberId] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sensor) return;
    setOptions(undefined);
    setMemberId(undefined);
    getBindOptions(sensor.orgId).then(setOptions, (e) => {
      setOptions([]);
      message.error(`加载用户失败：${errText(e)}`);
    });
  }, [sensor, message]);

  async function submit() {
    if (!sensor || !memberId) return;
    setSaving(true);
    try {
      await bindGaitSensor(sensor.id, memberId);
      message.success("已绑定");
      onDone();
    } catch (e) {
      message.error(`绑定失败：${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!sensor} title={`绑定用户：${sensor?.deviceName ?? ""}`} okText="绑定" okButtonProps={{ disabled: !memberId }} confirmLoading={saving} onOk={submit} onCancel={onClose} destroyOnHidden>
      <Select
        style={{ width: "100%" }}
        showSearch
        placeholder="搜索姓名或床位"
        loading={!options}
        value={memberId}
        onChange={setMemberId}
        optionFilterProp="label"
        options={(options ?? []).map((o) => ({ value: o.memberId, label: optionLabel(o) }))}
      />
    </Modal>
  );
}
