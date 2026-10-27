import { useEffect, useState } from "react";
import { App, Form, Input, Modal, Select, Typography } from "antd";
import { batchProcessAlerts, getProcessTypes, processAlert, type OpsAlert } from "../api/device";

/**
 * 处理告警：选处理类型、写处理结果（与网页端、用户端的处理弹窗提交的内容一致）。
 * 一条走 /api/alert/process，多条走 /api/alert/batch-process。
 * 处理类型每次打开都重新取，在"处理类型"里刚改过的马上能用
 */
export function ProcessDialog({ alerts, onClose, onDone }: { alerts: OpsAlert[] | null; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [types, setTypes] = useState<{ label: string; value: string }[]>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ type: string; result?: string }>();
  const open = !!alerts?.length;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setTypes(undefined);
    getProcessTypes().then(setTypes, () => setTypes([]));
  }, [open, form]);

  async function submit() {
    if (!alerts?.length) return;
    const v = await form.validateFields();
    setSaving(true);
    try {
      const result = v.result?.trim() ?? "";
      if (alerts.length === 1) await processAlert(alerts[0].id, v.type, result);
      else await batchProcessAlerts(alerts.map((a) => a.id), v.type, result);
      message.success(alerts.length === 1 ? "已处理" : `已处理 ${alerts.length} 条`);
      onClose();
      onDone();
    } catch (e) {
      message.error(`处理失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const one = alerts?.length === 1 ? alerts[0] : null;
  const times = (alerts ?? []).map((a) => a.createdAt).sort();
  const range = [times[0], times[times.length - 1]];
  return (
    <Modal open={open} title={one ? "处理告警" : `批量处理 ${alerts?.length ?? 0} 条告警`} okText="提交" onOk={submit} confirmLoading={saving} onCancel={onClose} destroyOnHidden>
      {open && (
        <>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            {one ? (
              <>
                <b>{one.alertTypeName}</b> · {[one.buildingName, one.floorName, one.roomName].filter(Boolean).join(" / ") || "位置未配置"} · 告警时间 {one.createdAt}
              </>
            ) : (
              <>
                告警时间 {range[0]} ～ {range[1]}，都按同一个处理类型和结果处理
              </>
            )}
          </Typography.Paragraph>
          <Form form={form} layout="vertical">
            {/* 处理时间不用填：平台按提交的时刻记（processAt） */}
            <Form.Item
              name="type"
              label="处理类型"
              rules={[{ required: true, message: "选择处理类型" }]}
              extra={types && !types.length ? "这个机构还没有处理类型，先到工作台 › 告警管理 › 处理类型 里添加" : undefined}
            >
              <Select loading={!types} options={types} placeholder="选择" />
            </Form.Item>
            <Form.Item name="result" label="处理结果">
              <Input.TextArea rows={3} maxLength={200} placeholder="例如：已到房间查看，老人安好" />
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  );
}
