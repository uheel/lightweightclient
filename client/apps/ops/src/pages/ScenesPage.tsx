import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Empty, Input, Progress, Segmented, Select, Space, Steps, Table, Tag, Tooltip } from "antd";
import type { TableColumnsType } from "antd";
import { ArrowLeftOutlined, ReloadOutlined, SearchOutlined, SendOutlined } from "@ant-design/icons";
import { getDeviceTypeMap, getRadars, type Radar } from "../api/device";
import {
  getDeviceScenes,
  getRoomLayouts,
  getSceneIssueStatus,
  getSceneTemplates,
  getTemplateScene,
  INSTALL_AREA,
  saveDeviceScenes,
  type RadarLayout,
  type Scene,
  type SceneTemplate,
} from "../api/scene";
import { AREA_NEED, INSTALL_NEED, pickTemplates, planDevice, pool, tplKey, type Choice, type DevicePlan, type OpKind } from "../scenes/plan";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const OP_TAG: Record<OpKind, { color?: string; text: string }> = {
  add: { color: "green", text: "新增" },
  replace: { color: "blue", text: "覆盖" },
  remove: { color: "red", text: "删除" },
  same: { text: "不变" },
  absent: { text: "无需删除" },
  skip: { color: "orange", text: "跳过" },
};

type SendState = { status: "waiting" | "sending" | "ok" | "fail"; text?: string };

/** 下发后等设备应答：轮询下发状态，直到时间变了且不再是"等待" */
async function waitIssued(deviceId: string, before: string | undefined, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await getSceneIssueStatus(deviceId);
    if (s.sceneIssueAt && s.sceneIssueAt !== before && s.sceneIssueStatus !== 1) {
      return s.sceneIssueStatus === 2 ? ({ status: "ok", text: s.sceneIssueAt } as SendState) : ({ status: "fail", text: s.sceneIssueError || "设备返回错误" } as SendState);
    }
  }
  return { status: "fail", text: "30 秒内设备没有应答" } as SendState;
}

/** 批量场景：选设备 → 选场景（启用 / 禁用）→ 预览 → 下发 */
export default function ScenesPage() {
  const { message, modal } = App.useApp();
  const [step, setStep] = useState(0);
  const [devices, setDevices] = useState<Radar[]>([]);
  const [types, setTypes] = useState<Map<number, string>>(new Map());
  const [templates, setTemplates] = useState<SceneTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // 第 1 步
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<number>();
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  // 第 2 步
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [overwrite, setOverwrite] = useState(false);

  // 第 3 步
  const [plans, setPlans] = useState<DevicePlan[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [send, setSend] = useState<Record<string, SendState>>({});
  const [sending, setSending] = useState(false);
  const planSeq = useRef(0);

  const load = async () => {
    setLoading(true);
    try {
      const [d, t] = await Promise.all([getRadars(), getSceneTemplates()]);
      setDevices(d);
      setTemplates(t);
    } catch (e) {
      message.error(`加载失败：${errText(e)}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    getDeviceTypeMap().then(setTypes, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typeName = (t?: number) => (t === undefined ? "未知型号" : types.get(t) ?? `型号 ${t}`);
  const picked = useMemo(() => pickTemplates(templates), [templates]);
  const tplTypes = useMemo(() => new Set(templates.map((t) => t.deviceType)), [templates]);

  // ---------- 第 1 步：选设备 ----------

  const typeOptions = useMemo(() => {
    const count = new Map<number, number>();
    for (const d of devices) if (d.deviceType !== undefined) count.set(d.deviceType, (count.get(d.deviceType) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ value: t, label: `${typeName(t)}（${n}）` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, types]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return devices.filter(
      (d) =>
        (typeFilter === undefined || d.deviceType === typeFilter) &&
        (!onlineOnly || d.isOnline) &&
        (!kw || [d.deviceName, d.sn, d.roomName, d.realName].some((v) => v?.toLowerCase().includes(kw))),
    );
  }, [devices, q, typeFilter, onlineOnly]);

  const selDevices = useMemo(() => {
    const ids = new Set(selected);
    return devices.filter((d) => ids.has(d.id));
  }, [devices, selected]);

  const deviceCols: TableColumnsType<Radar> = [
    {
      title: "设备",
      render: (_, d) => (
        <span className="scene-dev">
          <i className={`dot ${d.isDisabled ? "disabled" : d.isOnline ? "online" : "offline"}`} />
          <span>
            <b>{d.deviceName || d.sn}</b>
            <small className="mono">{d.sn}</small>
          </span>
        </span>
      ),
    },
    { title: "型号", width: 200, ellipsis: true, render: (_, d) => typeName(d.deviceType) },
    { title: "房间", width: 200, ellipsis: true, render: (_, d) => d.roomName || <span className="muted">未绑定</span> },
    {
      title: "",
      width: 110,
      render: (_, d) => (tplTypes.has(d.deviceType ?? -1) ? null : <span className="muted small">该型号没有模板</span>),
    },
  ];

  // ---------- 第 2 步：选场景 ----------

  interface SceneRow {
    name: string;
    group?: string;
    /** 型号 → 所选设备里该型号的台数 */
    support: [number, number][];
    unsupported: number;
  }

  const sceneRows = useMemo<SceneRow[]>(() => {
    const byType = new Map<number, number>();
    for (const d of selDevices) if (d.deviceType !== undefined) byType.set(d.deviceType, (byType.get(d.deviceType) ?? 0) + 1);
    const rows = new Map<string, SceneRow>();
    for (const t of picked.values()) {
      if (!byType.has(t.deviceType)) continue;
      const r = rows.get(t.templateName) ?? { name: t.templateName, group: t.sceneGroupName, support: [], unsupported: 0 };
      r.group ??= t.sceneGroupName;
      r.support.push([t.deviceType, byType.get(t.deviceType)!]);
      rows.set(t.templateName, r);
    }
    for (const r of rows.values()) r.unsupported = selDevices.length - r.support.reduce((n, [, c]) => n + c, 0);
    return [...rows.values()].sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || b.support.length - a.support.length);
  }, [picked, selDevices]);

  const activeChoices = Object.entries(choices).filter(([, c]) => c !== "keep");

  const sceneCols: TableColumnsType<SceneRow> = [
    { title: "场景", dataIndex: "name", width: 160, render: (v) => <b className="scene-name">{v}</b> },
    { title: "分组", dataIndex: "group", width: 100, render: (v) => v || <span className="muted">—</span> },
    {
      title: "适用设备",
      render: (_, r) => (
        <span className="scene-support">
          {r.support.map(([t, n]) => (
            <Tag key={t} bordered={false}>
              {typeName(t)} · {n} 台
            </Tag>
          ))}
          {r.unsupported > 0 && <span className="muted small">另 {r.unsupported} 台不支持</span>}
        </span>
      ),
    },
    {
      title: "需要",
      width: 150,
      render: (_, r) =>
        AREA_NEED[r.name] ? (
          <span className="small">户型里的{AREA_NEED[r.name]!.label}</span>
        ) : INSTALL_NEED[r.name] !== undefined ? (
          <span className="small">装在{INSTALL_AREA[INSTALL_NEED[r.name]!]}的雷达</span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      title: "操作",
      width: 200,
      render: (_, r) => (
        <Segmented<Choice>
          size="small"
          value={choices[r.name] ?? "keep"}
          onChange={(v) => setChoices((c) => ({ ...c, [r.name]: v }))}
          options={[
            { value: "keep", label: "不变" },
            { value: "enable", label: "启用" },
            { value: "disable", label: "禁用" },
          ]}
        />
      ),
    },
  ];

  // ---------- 第 3 步：预览 ----------

  async function buildPlans() {
    const seq = ++planSeq.current;
    setStep(2);
    setPlans([]);
    setSend({});
    setProgress({ done: 0, total: selDevices.length });
    const list = activeChoices as [string, Choice][];

    // 用到的模板场景定义
    const need = new Map<string, SceneTemplate>();
    for (const d of selDevices)
      for (const [name, c] of list) {
        const t = c === "enable" ? picked.get(tplKey(d.deviceType, name)) : undefined;
        if (t) need.set(t.id, t);
      }
    const defs = new Map<string, Scene>();
    try {
      await pool([...need.values()], 4, async (t) => {
        const s = await getTemplateScene(t.id);
        if (s) defs.set(tplKey(t.deviceType, t.templateName), s);
      });
    } catch (e) {
      message.error(`读取场景模板失败：${errText(e)}`);
      setProgress(undefined);
      return;
    }

    // 房间布局按房间取一次
    const rooms = new Map<string, Promise<Map<string, RadarLayout>>>();
    const layoutOf = (d: Radar) => {
      if (!d.roomId) return Promise.resolve(undefined);
      let p = rooms.get(d.roomId);
      if (!p) rooms.set(d.roomId, (p = getRoomLayouts(d.roomId)));
      return p.then((m) => m.get(d.sn));
    };
    // 只有涉及区域或安装区域的场景才需要房间布局
    const needLayout = list.some(([name, c]) => c === "enable" && (AREA_NEED[name] || INSTALL_NEED[name] !== undefined));

    const out: DevicePlan[] = new Array(selDevices.length);
    let done = 0;
    await pool(selDevices, 6, async (device, i) => {
      try {
        const [current, layout] = await Promise.all([getDeviceScenes(device.id), needLayout ? layoutOf(device) : undefined]);
        out[i] = planDevice({
          device,
          current,
          layout,
          choices: list,
          templateScene: (t, name) => defs.get(tplKey(t, name)),
          overwrite,
        });
      } catch (e) {
        out[i] = { device, ops: [], dropped: 0, error: errText(e) };
      }
      done++;
      if (seq === planSeq.current) setProgress({ done, total: selDevices.length });
    });
    if (seq !== planSeq.current) return;
    setPlans(out);
    setProgress(undefined);
  }

  const toSend = plans.filter((p) => p.scenes);
  const summary = useMemo(() => {
    const s = { send: 0, none: 0, blocked: 0, error: 0, skips: 0 };
    for (const p of plans) {
      if (p.error) s.error++;
      else if (p.blocked) s.blocked++;
      else if (p.scenes) s.send++;
      else s.none++;
      s.skips += p.ops.filter((o) => o.kind === "skip").length;
    }
    return s;
  }, [plans]);

  function confirmSend() {
    modal.confirm({
      title: `下发到 ${toSend.length} 台设备？`,
      content: "每台设备的场景列表会整体替换：新增、覆盖、删除按预览执行，其他场景保持不变。",
      okText: "下发",
      onOk: doSend,
    });
  }

  async function doSend() {
    setSending(true);
    setSend(Object.fromEntries(toSend.map((p) => [p.device.id, { status: "waiting" } as SendState])));
    const upd = (id: string, s: SendState) => setSend((m) => ({ ...m, [id]: s }));
    await pool(toSend, 3, async (p) => {
      upd(p.device.id, { status: "sending" });
      try {
        const before = (await getSceneIssueStatus(p.device.id)).sceneIssueAt;
        await saveDeviceScenes(p.device.sn, p.scenes!);
        upd(p.device.id, await waitIssued(p.device.id, before));
      } catch (e) {
        upd(p.device.id, { status: "fail", text: errText(e) });
      }
    });
    setSending(false);
  }

  const sendCount = useMemo(() => {
    const v = Object.values(send);
    return { ok: v.filter((s) => s.status === "ok").length, fail: v.filter((s) => s.status === "fail").length, total: v.length };
  }, [send]);

  const planCols: TableColumnsType<DevicePlan> = [
    {
      title: "设备",
      width: 230,
      render: (_, p) => (
        <span className="scene-dev">
          <i className={`dot ${p.device.isDisabled ? "disabled" : p.device.isOnline ? "online" : "offline"}`} />
          <span>
            <b>{p.device.deviceName || p.device.sn}</b>
            <small>
              {typeName(p.device.deviceType)} · {p.device.roomName || "未绑定房间"}
            </small>
          </span>
        </span>
      ),
    },
    {
      title: "变更",
      render: (_, p) =>
        p.error ? (
          <span className="err-text">读取失败：{p.error}</span>
        ) : (
          <div className="scene-ops">
            {p.ops.map((o) => (
              <span key={o.name} className={`scene-op ${o.kind}`}>
                <Tag color={OP_TAG[o.kind].color} bordered={false}>
                  {OP_TAG[o.kind].text}
                </Tag>
                {o.name}
                {o.note && <small>{o.note}</small>}
              </span>
            ))}
            {p.scenes && p.dropped > 0 && <span className="muted small">另会清掉 {p.dropped} 个已停用场景</span>}
          </div>
        ),
    },
    {
      title: "结果",
      width: 190,
      render: (_, p) => {
        const s = send[p.device.id];
        if (s) {
          if (s.status === "ok") return <Tag color="success">已生效</Tag>;
          if (s.status === "fail")
            return (
              <Tooltip title={s.text}>
                <span className="scene-fail">
                  <Tag color="error">失败</Tag>
                  <span className="small err-text">{s.text}</span>
                </span>
              </Tooltip>
            );
          return <Tag color="processing">{s.status === "sending" ? "等待设备应答" : "排队中"}</Tag>;
        }
        if (p.error) return <Tag color="error">无法预览</Tag>;
        if (p.blocked) return <Tag color="warning">不下发：{p.blocked}</Tag>;
        return p.scenes ? <Tag color="blue">待下发 · {p.scenes.length} 个场景</Tag> : <span className="muted">无变化</span>;
      },
    },
  ];

  // ---------- 渲染 ----------

  return (
    <div className="page scene-page">
      <div className="page-head">
        <h1>批量场景</h1>
        <Steps
          size="small"
          current={step}
          style={{ maxWidth: 560 }}
          items={[{ title: "选设备" }, { title: "选场景" }, { title: "预览并下发" }]}
        />
      </div>

      {step === 0 && (
        <div className="ops-card">
          <div className="toolbar">
            <Input
              allowClear
              style={{ width: 240 }}
              prefix={<SearchOutlined style={{ color: "#8A8FA8" }} />}
              placeholder="名称 / SN / 房间 / 长者"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select allowClear style={{ width: 240 }} placeholder="全部型号" value={typeFilter} onChange={setTypeFilter} options={typeOptions} />
            <Checkbox checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)}>
              只看在线
            </Checkbox>
            <Button type="text" icon={<ReloadOutlined />} onClick={load} title="刷新" />
            <span className="grow" />
            <span className="muted">已选 {selected.length} 台</span>
            {selected.length > 0 && (
              <Button type="link" onClick={() => setSelected([])}>
                清空
              </Button>
            )}
            <Button type="primary" disabled={!selected.length} onClick={() => setStep(1)}>
              下一步：选场景
            </Button>
          </div>
          <Table<Radar>
            rowKey="id"
            size="small"
            loading={loading}
            columns={deviceCols}
            dataSource={shown}
            pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (n) => `共 ${n} 台` }}
            rowSelection={{
              selectedRowKeys: selected,
              preserveSelectedRowKeys: true,
              onChange: (keys) => setSelected(keys as string[]),
              getCheckboxProps: (d) => ({ disabled: !tplTypes.has(d.deviceType ?? -1) }),
            }}
            scroll={{ y: "calc(100vh - 330px)" }}
          />
        </div>
      )}

      {step === 1 && (
        <div className="ops-card">
          <div className="toolbar">
            <Button icon={<ArrowLeftOutlined />} onClick={() => setStep(0)}>
              改选设备
            </Button>
            <span className="muted">
              {selDevices.length} 台设备，可选 {sceneRows.length} 个场景。只改选了"启用"或"禁用"的场景，其余保持不变
            </span>
            <span className="grow" />
            <Checkbox checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)}>
              已有同名场景时用模板覆盖
            </Checkbox>
            {activeChoices.length > 0 && (
              <Button type="link" onClick={() => setChoices({})}>
                全部还原
              </Button>
            )}
            <Button type="primary" disabled={!activeChoices.length} onClick={buildPlans}>
              下一步：预览（{activeChoices.length}）
            </Button>
          </div>
          <Table<SceneRow>
            rowKey="name"
            size="small"
            columns={sceneCols}
            dataSource={sceneRows}
            pagination={false}
            rowClassName={(r) => `scene-row-${choices[r.name] ?? "keep"}`}
            scroll={{ y: "calc(100vh - 300px)" }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所选设备的型号没有场景模板" /> }}
          />
        </div>
      )}

      {step === 2 && (
        <div className="ops-card">
          <div className="toolbar">
            <Button icon={<ArrowLeftOutlined />} disabled={sending} onClick={() => setStep(1)}>
              改选场景
            </Button>
            {progress ? (
              <span className="scene-progress">
                读取设备场景和房间布局 {progress.done} / {progress.total}
                <Progress percent={Math.round((progress.done / Math.max(1, progress.total)) * 100)} size="small" showInfo={false} />
              </span>
            ) : (
              <Space size={16} className="small">
                <span>
                  待下发 <b>{summary.send}</b> 台
                </span>
                <span className="muted">无变化 {summary.none} 台</span>
                {summary.blocked > 0 && <span className="warn-text">离线或停用不下发 {summary.blocked} 台</span>}
                {summary.error > 0 && <span className="err-text">读取失败 {summary.error} 台</span>}
                {summary.skips > 0 && <span className="warn-text">跳过 {summary.skips} 项</span>}
                {sendCount.total > 0 && (
                  <span>
                    已下发：成功 {sendCount.ok}，失败 {sendCount.fail}，共 {sendCount.total}
                  </span>
                )}
              </Space>
            )}
            <span className="grow" />
            <Button icon={<ReloadOutlined />} disabled={sending || !!progress} onClick={buildPlans}>
              重新预览
            </Button>
            <Button type="primary" icon={<SendOutlined />} loading={sending} disabled={!!progress || !toSend.length || sendCount.total > 0} onClick={confirmSend}>
              下发到 {toSend.length} 台
            </Button>
          </div>
          {!progress && summary.skips > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 10 }}
              message="有场景被跳过"
              description="跳过的场景不会改动设备（已有的保持原样，没有的不会加上）。多数是户型里没画对应区域，或没设置空间区域类型（马桶 / 淋浴 / 沙发），补好户型后重新预览即可。"
            />
          )}
          <Table<DevicePlan>
            rowKey={(p) => p.device.id}
            size="small"
            loading={!!progress}
            columns={planCols}
            dataSource={plans}
            pagination={false}
            scroll={{ y: "calc(100vh - 360px)" }}
          />
        </div>
      )}
    </div>
  );
}
