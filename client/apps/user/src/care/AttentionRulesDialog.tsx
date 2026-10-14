import { useEffect, useMemo, useState } from "react";
import { App, Button, InputNumber, Modal, Switch } from "antd";
import { useCare } from "./CareContext";
import { DEFAULT_RULES, getAttentionRules, ruleHits, saveAttentionRules, type AttentionRules } from "./attention";

/**
 * 需关注规则设置：阈值保存在本机，保存后总览、长者、健康、详情页立即按新规则刷新。
 * 编辑时实时预览每条规则会命中多少位长者，方便调到合适的值。
 */
export default function AttentionRulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const { members, sleepReports, alerts } = useCare();
  const [draft, setDraft] = useState<AttentionRules>(getAttentionRules());

  useEffect(() => {
    if (open) setDraft(getAttentionRules());
  }, [open]);

  const hits = useMemo(() => ruleHits(members, sleepReports, alerts.list, draft), [members, sleepReports, alerts.list, draft]);
  const set = <K extends keyof AttentionRules>(k: K, v: AttentionRules[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const rows: { key: keyof AttentionRules; title: string; desc: string; input: React.ReactNode }[] = [
    {
      key: "fallAlert",
      title: "未处理的跌倒告警",
      desc: "有跌倒类告警还没处理的长者，排在名单最前面",
      input: <Switch checked={draft.fallAlert} onChange={(v) => set("fallAlert", v)} />,
    },
    {
      key: "lowScore",
      title: "睡眠评分低于",
      desc: "昨夜睡眠报告的评分。参考：80 以上睡得不错，60 以下需要关注",
      input: <InputNumber min={0} max={100} value={draft.lowScore} onChange={(v) => set("lowScore", v ?? 0)} addonAfter="分" style={{ width: 130 }} />,
    },
    {
      key: "shortSleepHours",
      title: "夜间睡眠少于",
      desc: "昨夜实际睡着的总时长（不含在床清醒、离床）",
      input: (
        <InputNumber min={0} max={12} step={0.5} value={draft.shortSleepHours} onChange={(v) => set("shortSleepHours", v ?? 0)} addonAfter="小时" style={{ width: 130 }} />
      ),
    },
    {
      key: "frequentLeaveBed",
      title: "夜间离床达到",
      desc: "昨夜睡眠报告统计的离床次数。起夜多的机构可以适当调高",
      input: <InputNumber min={0} max={50} value={draft.frequentLeaveBed} onChange={(v) => set("frequentLeaveBed", v ?? 0)} addonAfter="次" style={{ width: 130 }} />,
    },
    {
      key: "highAhi",
      title: "呼吸紊乱指数达到",
      desc: "每小时呼吸暂停 / 低通气次数（AHI）。参考：5–15 轻度，15–30 中度，30 以上重度",
      input: <InputNumber min={0} max={100} value={draft.highAhi} onChange={(v) => set("highAhi", v ?? 0)} style={{ width: 130 }} />,
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="需关注规则"
      width={620}
      footer={[
        <Button key="reset" onClick={() => setDraft({ ...DEFAULT_RULES })}>
          恢复默认
        </Button>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="ok"
          type="primary"
          onClick={() => {
            saveAttentionRules(draft);
            message.success("需关注规则已更新");
            onClose();
          }}
        >
          保存
        </Button>,
      ]}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        满足任意一条就列入"今日需关注"。数值填 0 表示不启用这一条。规则保存在这台电脑上。
      </p>
      <div className="rules">
        {rows.map((r) => (
          <div key={r.key} className="rule-row">
            <div className="rule-text">
              <b>{r.title}</b>
              <small>{r.desc}</small>
            </div>
            <div className="rule-input">{r.input}</div>
            <div className="rule-hit">{sleepReports ? `${hits[r.key]} 位` : "…"}</div>
          </div>
        ))}
      </div>
      <p style={{ margin: "14px 0 0" }}>
        按这组规则，今日需关注共 <b>{sleepReports ? hits.total : "…"}</b> 位
        <span className="muted">（共 {members.length} 位长者，{sleepReports?.size ?? "…"} 位有昨夜睡眠报告）</span>
      </p>
    </Modal>
  );
}
