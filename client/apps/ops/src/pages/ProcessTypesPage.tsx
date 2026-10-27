import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Table } from "antd";
import type { TableColumnsType } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { deleteProcessType, getProcessType, listProcessTypes, saveProcessType, type AlertProcessType } from "../api/device";

type FormValues = Pick<AlertProcessType, "alertProcessTypeName" | "sortOrder" | "description">;

/**
 * 告警处理类型：处理告警时可选的类型（例如 有效告警 / 家属走动 / 误报 / 其他），按机构自定义。
 * 和网页端 告警管理 › 处理类型 是同一份数据（/api/alert-process-type），字段也一样：名称、排序值、备注
 */
export default function ProcessTypesPage() {
  const { message, modal } = App.useApp();
  const [list, setList] = useState<AlertProcessType[]>([]);
  const [loading, setLoading] = useState(false);
  /** 正在编辑的；{} 是新增 */
  const [editing, setEditing] = useState<Partial<AlertProcessType> | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listProcessTypes();
      // 排序值相同按添加先后，和处理告警时的下拉一致
      setList([...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "")));
    } catch (e) {
      message.error(`读取处理类型失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    load();
  }, [load]);

  async function openEdit(row: Partial<AlertProcessType>) {
    let t = row;
    // 列表里没有备注，编辑前取详情，否则保存会把原来的备注清掉
    if (row.id) {
      try {
        t = { ...row, ...(await getProcessType(row.id)) };
      } catch (e) {
        message.error(`读取处理类型失败：${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    setEditing(t);
    form.setFieldsValue({
      alertProcessTypeName: t.alertProcessTypeName,
      // 新增默认排在最后
      sortOrder: t.id ? t.sortOrder : Math.max(0, ...list.map((x) => x.sortOrder ?? 0)) + 1,
      description: t.description,
    });
  }

  async function submit() {
    if (!editing) return;
    const v = await form.validateFields();
    const name = v.alertProcessTypeName.trim();
    if (list.some((x) => x.id !== editing.id && x.alertProcessTypeName === name)) {
      form.setFields([{ name: "alertProcessTypeName", errors: ["已经有这个类型了"] }]);
      return;
    }
    setSaving(true);
    try {
      await saveProcessType({ id: editing.id, alertProcessTypeName: name, sortOrder: v.sortOrder ?? 0, description: v.description?.trim() || undefined });
      message.success(editing.id ? "已保存" : "已添加");
      setEditing(null);
      load();
    } catch (e) {
      message.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  function remove(t: AlertProcessType) {
    modal.confirm({
      title: `删除处理类型"${t.alertProcessTypeName}"？`,
      content: "已经按这个类型处理过的告警不受影响，以后处理告警时不能再选它。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProcessType(t.id);
          message.success("已删除");
          load();
        } catch (e) {
          message.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
        }
      },
    });
  }

  const columns: TableColumnsType<AlertProcessType> = [
    { title: "排序", dataIndex: "sortOrder", width: 70, render: (v) => <span className="mono">{v ?? "—"}</span> },
    { title: "类型名字", dataIndex: "alertProcessTypeName", width: 220, ellipsis: true },
    { title: "更新时间", width: 170, render: (_, r) => <span className="mono">{r.updatedAt || r.createdAt || "—"}</span> },
    { title: "更新人", dataIndex: "updatedBy", ellipsis: true, render: (v) => v || "—" },
    {
      title: "操作",
      width: 120,
      align: "right",
      render: (_, r) => (
        <>
          <Button type="link" size="small" style={{ paddingLeft: 0 }} onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => remove(r)}>
            删除
          </Button>
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>处理类型</h1>
      </div>
      <div className="ops-card">
        <div className="toolbar">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit({})}>
            添加类型
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load} title="刷新" />
          <span className="muted small">处理告警时从这里选类型；和网页端"告警处理类型"是同一份</span>
        </div>
        <Table<AlertProcessType> rowKey="id" size="small" loading={loading} columns={columns} dataSource={list} tableLayout="fixed" pagination={false} />
      </div>
      <Modal
        open={!!editing}
        title={editing?.id ? "编辑处理类型" : "添加处理类型"}
        okText={editing?.id ? "保存" : "添加"}
        onOk={submit}
        confirmLoading={saving}
        onCancel={() => setEditing(null)}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item name="alertProcessTypeName" label="类型名字" rules={[{ required: true, whitespace: true, message: "填写类型名字" }]}>
            <Input maxLength={50} placeholder="例如：误报" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序值" tooltip="从小到大排序，处理告警时按这个顺序列出">
            <InputNumber min={-99999} max={99999} precision={0} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="description" label="备注">
            <Input.TextArea rows={3} maxLength={200} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
