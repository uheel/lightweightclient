import { useEffect, useState } from "react";
import { Alert, App, Button, Input, Modal, Radio, Skeleton } from "antd";
import { getProcessTypes, processAlert, type CareAlert, type Option } from "./api";
import { sinceText } from "./state";

/**
 * 处理告警弹窗（界面稿"告警到达与处理"第 ② ③ 步合并）。
 * 提交的内容与网页端完全一致：处理类型 + 处理结果，写回平台。
 */
export default function AlertProcessDialog({
  alert,
  now,
  onClose,
  onDone,
}: {
  alert: CareAlert | null;
  now: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [types, setTypes] = useState<Option[]>();
  const [typeError, setTypeError] = useState<string>();
  const [typeId, setTypeId] = useState<string>();
  const [result, setResult] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  // 每次打开重置表单；处理类型按机构加载一次
  useEffect(() => {
    if (!alert) return;
    setTypeId(undefined);
    setResult("");
    setError(undefined);
    if (!types) {
      getProcessTypes().then(setTypes, (e) => setTypeError(e instanceof Error ? e.message : String(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.id]);

  async function submit() {
    if (!alert) return;
    if (!typeId) {
      setError("请选择实际情况");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await processAlert(alert.id, typeId, result.trim());
      message.success("已记录处理结果");
      onDone();
      onClose();
    } catch (e) {
      setError(`提交失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  }

  const who = alert?.members?.map((m) => `${m.realName}${m.age ? ` · ${m.age} 岁` : ""}`).join("、");
  const where = alert ? [alert.buildingName, alert.floorName, alert.roomName].filter(Boolean).join(" · ") : "";

  return (
    <Modal
      open={!!alert}
      onCancel={onClose}
      width={520}
      title={null}
      closable={!submitting}
      maskClosable={false}
      destroyOnHidden
      styles={{ content: { padding: 0, overflow: "hidden" } }}
      footer={null}
    >
      {alert && (
        <>
          <div className="process-head">
            <div>
              <small>{alert.createdAt}</small>
              <b>{alert.alertTypeName}</b>
            </div>
            <div className="process-since">
              <small>距今</small>
              <span>{sinceText(alert.createdAt, now)}</span>
            </div>
          </div>
          <div className="process-body">
            <dl>
              <dt>长者</dt>
              <dd>{who || "未关联长者"}</dd>
              <dt>位置</dt>
              <dd>{where || "未配置"}</dd>
            </dl>

            <div className="process-label">实际情况</div>
            {typeError ? (
              <Alert type="error" showIcon message={`加载处理类型失败：${typeError}`} />
            ) : !types ? (
              <Skeleton.Input active block />
            ) : (
              <Radio.Group className="process-types" value={typeId} onChange={(e) => (setTypeId(e.target.value), setError(undefined))}>
                {types.map((t) => (
                  <Radio.Button key={t.value} value={t.value}>
                    {t.label}
                  </Radio.Button>
                ))}
              </Radio.Group>
            )}

            <div className="process-label">处理说明（选填）</div>
            <Input.TextArea
              rows={3}
              maxLength={200}
              showCount
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder="例如：在卫生间门口坐地，已扶起，生命体征平稳"
            />

            {error && <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} />}

            <div className="process-actions">
              <Button size="large" onClick={onClose} disabled={submitting}>
                稍后处理
              </Button>
              <Button size="large" type="primary" onClick={submit} loading={submitting} disabled={!types?.length}>
                完成处理
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
