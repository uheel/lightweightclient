import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Modal, Radio, Segmented, Spin, Table, Tag } from "antd";
import { getAssessPanel, getAssessRecord, getAssessRecords, getScale, submitAssess, type AssessPanel, type AssessRecord, type ScaleQuestion } from "../api/gait";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const RISK_COLOR: Record<number, string> = { 1: "green", 2: "orange", 3: "red" };

/** 用户的健康评估：选量表，看历史记录，做一次新的评估。分数和风险等级由平台按量表规则算 */
export function Assessment({ memberId, memberName }: { memberId: string; memberName: string }) {
  const { message } = App.useApp();
  const [panel, setPanel] = useState<AssessPanel>();
  const [scaleId, setScaleId] = useState<string>();
  const [records, setRecords] = useState<AssessRecord[]>();
  const [running, setRunning] = useState(false);
  const [viewing, setViewing] = useState<string>();

  const loadPanel = useCallback(async () => {
    try {
      const p = await getAssessPanel(memberId);
      setPanel(p);
      setScaleId((old) => (p.scales?.some((x) => x.id === old) ? old : p.scales?.[0]?.id));
    } catch (e) {
      setPanel({});
      message.error(`加载健康评估失败：${errText(e)}`);
    }
  }, [memberId, message]);

  const loadRecords = useCallback(async () => {
    if (!scaleId) return setRecords([]);
    setRecords(undefined);
    try {
      setRecords(await getAssessRecords(memberId, scaleId));
    } catch (e) {
      setRecords([]);
      message.error(`加载评估记录失败：${errText(e)}`);
    }
  }, [memberId, scaleId, message]);

  useEffect(() => {
    loadPanel();
  }, [loadPanel]);
  useEffect(() => {
    if (panel) loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleId, !!panel]);

  const scales = panel?.scales ?? [];
  const scale = scales.find((x) => x.id === scaleId);
  const m = panel?.member;

  return (
    <div className="ops-card">
      <h2>
        健康评估
        {m?.currentRiskLevelName && <Tag color={m.currentRiskType ? RISK_COLOR[m.currentRiskType] : undefined}>当前 {m.currentRiskLevelName}</Tag>}
        <span style={{ flex: 1 }} />
        <Button type="primary" size="small" disabled={!scaleId} onClick={() => setRunning(true)}>
          开始评估
        </Button>
      </h2>
      {!panel ? (
        <Spin />
      ) : !scales.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="平台上还没有评估量表" />
      ) : (
        <>
          {scales.length > 1 && <Segmented size="small" style={{ marginBottom: 8 }} value={scaleId} onChange={(v) => setScaleId(v as string)} options={scales.map((x) => ({ value: x.id, label: x.scaleName }))} />}
          <div className="muted small" style={{ marginBottom: 8 }}>
            {[scale?.scaleName, scale?.questionCount && `${scale.questionCount} 题`, scale?.description].filter(Boolean).join(" · ")}
          </div>
          <Table<AssessRecord>
            size="small"
            rowKey={(r) => r.id ?? `${r.assessmentTime}-${r.totalScore}`}
            loading={!records}
            dataSource={records}
            pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
            locale={{ emptyText: "还没有评估记录" }}
            onRow={(r) => ({ onClick: () => r.id && setViewing(r.id), style: { cursor: "pointer" } })}
            columns={[
              { title: "评估时间", dataIndex: "assessmentTime", width: 180 },
              { title: "得分", dataIndex: "totalScore", width: 80, render: (v?: number) => `${v ?? 0} 分` },
              { title: "风险等级", dataIndex: "riskLevelName", width: 110, render: (v: string | undefined, r) => <Tag color={r.riskType ? RISK_COLOR[r.riskType] : undefined}>{v || "-"}</Tag> },
              { title: "评估建议", dataIndex: "healthAdvice", ellipsis: true },
            ]}
          />
        </>
      )}
      <RunDialog
        open={running}
        memberId={memberId}
        memberName={memberName}
        scaleId={scaleId}
        onClose={() => setRunning(false)}
        onSubmitted={() => {
          loadPanel();
          loadRecords();
        }}
      />
      <ResultDialog id={viewing} onClose={() => setViewing(undefined)} />
    </div>
  );
}

function RunDialog({
  open,
  memberId,
  memberName,
  scaleId,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  memberId: string;
  memberName: string;
  scaleId?: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { message } = App.useApp();
  const [scale, setScale] = useState<{ scaleName: string; description?: string; questions?: ScaleQuestion[] }>();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<AssessRecord>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !scaleId) return;
    setScale(undefined);
    setAnswers({});
    setResult(undefined);
    getScale(scaleId).then(setScale, (e) => message.error(`加载量表失败：${errText(e)}`));
  }, [open, scaleId, message]);

  async function submit() {
    const qs = scale?.questions ?? [];
    if (!scaleId || !qs.length) return;
    const missing = qs.findIndex((_, i) => answers[i] === undefined);
    if (missing >= 0) return void message.warning(`第 ${missing + 1} 题还没选`);
    setSaving(true);
    try {
      setResult(await submitAssess(memberId, scaleId, qs.map((_, i) => answers[i])));
      message.success("评估已保存");
      onSubmitted();
    } catch (e) {
      message.error(`提交失败：${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      width={720}
      title={`健康评估：${memberName}`}
      onCancel={onClose}
      destroyOnHidden
      footer={
        result ? (
          <Button type="primary" onClick={onClose}>
            完成
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} disabled={!scale} onClick={submit}>
              提交评估
            </Button>
          </>
        )
      }
    >
      {!scale ? (
        <Spin />
      ) : (
        <div className="gait-assess">
          {result && <ResultSummary r={{ ...result, scaleName: result.scaleName ?? scale.scaleName }} />}
          <b>{scale.scaleName}</b>
          {scale.description && <div className="muted small">{scale.description}</div>}
          {(scale.questions ?? []).map((q, i) => (
            <div key={i} className="gait-question">
              <div className="gait-question-title">
                {i + 1}. {q.title}
              </div>
              <Radio.Group
                disabled={!!result}
                value={answers[i]}
                onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value as number }))}
                options={(q.options ?? []).map((o, j) => ({ value: j, label: `${o.label ? `${o.label}. ` : ""}${o.text ?? ""}（${o.score ?? 0} 分）` }))}
              />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ResultSummary({ r }: { r: AssessRecord }) {
  return (
    <div className="gait-result">
      <b className="gait-result-score">{r.totalScore ?? 0} 分</b>
      <Tag color={r.riskType ? RISK_COLOR[r.riskType] : undefined}>{r.riskLevelName || "-"}</Tag>
      <span className="muted small">{r.assessmentTime}</span>
      {r.healthAdvice && <p>{r.healthAdvice}</p>}
    </div>
  );
}

function ResultDialog({ id, onClose }: { id?: string; onClose: () => void }) {
  const { message } = App.useApp();
  const [r, setR] = useState<AssessRecord>();

  useEffect(() => {
    setR(undefined);
    if (!id) return;
    getAssessRecord(id).then(setR, (e) => message.error(`加载失败：${errText(e)}`));
  }, [id, message]);

  return (
    <Modal open={!!id} width={720} title={r?.scaleName ?? "评估结果"} footer={null} onCancel={onClose} destroyOnHidden>
      {!r ? (
        <Spin />
      ) : (
        <div className="gait-assess">
          <ResultSummary r={r} />
          {(r.answers ?? []).map((a, i) => (
            <div key={a.questionIndex ?? i} className="gait-question">
              <div className="gait-question-title">
                {(a.questionIndex ?? i) + 1}. {a.questionTitle}
              </div>
              <span className="muted">
                {a.optionLabel ? `${a.optionLabel}. ` : ""}
                {a.optionText || "-"}（+{a.score ?? 0} 分）
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
