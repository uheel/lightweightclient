import { useMemo, useState } from "react";
import { Alert, Button, Empty, Skeleton } from "antd";
import type { Session } from "@radar/core";
import { useCareData } from "../care/useCareData";
import { alertLocation, careState, sinceText, TONE_STYLE, type CareState } from "../care/state";
import { ATTENTION_REASON, type CareAlert, type Member } from "../care/api";
import ElderDetail from "./ElderDetail";

type Filter = "all" | "attention" | "bed" | "away" | "paused";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "attention", label: "需关注" },
  { key: "bed", label: "在床" },
  { key: "away", label: "离床 / 不在" },
  { key: "paused", label: "暂停监测" },
];

function match(f: Filter, st: CareState, m: Member, attention: Set<string>) {
  switch (f) {
    case "attention":
      return st.tone === "alert" || st.tone === "warn" || m.focusLevel === 1 || attention.has(m.memberId);
    case "bed":
      return st.tone === "bed";
    case "away":
      return st.tone === "idle";
    case "paused":
      return st.tone === "unknown";
    default:
      return true;
  }
}

/** 告警优先，其次需留意，再按床位排序 */
const TONE_ORDER = { alert: 0, warn: 1, active: 2, bed: 3, idle: 4, unknown: 5 } as const;

export default function CareHome({
  s,
  alerts,
  onProcess,
}: {
  s: Session;
  /** 待处理告警（应用层 useAlertWatcher 统一维护） */
  alerts: { list: CareAlert[]; total: number };
  onProcess: (a: CareAlert) => void;
}) {
  const { members, attention, alertByMember, liveOf, loading, error, now } = useCareData(s.orgId, alerts.list);
  const [filter, setFilter] = useState<Filter>("all");
  const setProcessing = onProcess;
  /** 正在查看详情的长者 */
  const [selected, setSelected] = useState<string>();

  const attentionIds = useMemo(() => new Set(attention.items.map((a) => a.memberId)), [attention.items]);

  const rows = useMemo(
    () =>
      members
        .map((m) => ({ m, st: careState(m, liveOf(m), alertByMember[m.memberId], now) }))
        .sort((a, b) => TONE_ORDER[a.st.tone] - TONE_ORDER[b.st.tone] || (a.m.bedName ?? "").localeCompare(b.m.bedName ?? "", "zh")),
    [members, liveOf, alertByMember, now],
  );
  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    for (const f of FILTERS) c[f.key] = rows.filter((r) => match(f.key, r.st, r.m, attentionIds)).length;
    return c;
  }, [rows, attentionIds]);
  const selectedMember = selected ? members.find((m) => m.memberId === selected) : undefined;
  const visible = rows.filter((r) => match(filter, r.st, r.m, attentionIds));
  const inRoom = rows.filter((r) => r.st.tone !== "idle" && r.st.tone !== "unknown").length;

  return (
    <div className="care">
      {selectedMember ? (
        <main className="care-main">
          <ElderDetail
            orgId={s.orgId}
            member={selectedMember}
            live={liveOf(selectedMember)}
            alert={alertByMember[selectedMember.memberId]}
            attention={attention.items.find((a) => a.memberId === selectedMember.memberId)}
            now={now}
            onBack={() => setSelected(undefined)}
            onProcess={onProcess}
          />
        </main>
      ) : (
      <main className="care-main">
        <div className="care-head">
          <div>
            <h1>{s.orgName}</h1>
            <p>
              {members.length} 位长者 · {inRoom} 位在房间内
            </p>
          </div>
          <div className="chips" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                className={`chip${filter === f.key ? " on" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span className="mono">{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {error && <Alert type="error" showIcon message={`加载长者列表失败：${error}`} />}
        {loading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : visible.length === 0 ? (
          <div className="card" style={{ padding: 48 }}>
            <Empty description={members.length ? "没有符合条件的长者" : "这个机构还没有绑定床位的长者"} />
          </div>
        ) : (
          <div className="elder-grid">
            {visible.map(({ m, st }) => {
              const tone = TONE_STYLE[st.tone];
              const live = liveOf(m);
              const showVitals = st.tone === "bed" && (live?.heartRate || live?.respiratoryRate);
              const note = attention.items.find((a) => a.memberId === m.memberId);
              return (
                <article
                  key={m.memberId}
                  className={`elder-card clickable tone-${st.tone}`}
                  style={{ borderColor: tone.border }}
                  onClick={() => setSelected(m.memberId)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setSelected(m.memberId)}
                >
                  <div className="elder-who">
                    <span className="elder-avatar" style={{ background: tone.bg, color: tone.color }}>
                      {m.realName.charAt(0)}
                    </span>
                    <span className="elder-name">
                      <b>{m.realName}</b>
                      <small>
                        {[m.age ? `${m.age} 岁` : "", m.bedName].filter(Boolean).join(" · ") || "未分配床位"}
                      </small>
                    </span>
                    {m.focusLevel === 1 && <span className="focus-tag">重点关注</span>}
                  </div>
                  <div className="elder-state">
                    <span style={{ color: tone.color }}>{st.text}</span>
                    {st.detail && <small>{st.detail}</small>}
                  </div>
                  <div className="elder-vitals">
                    {showVitals ? (
                      <>
                        <span>
                          心率 <b className="mono">{live?.heartRate ?? "—"}</b>
                        </span>
                        <span>
                          呼吸 <b className="mono">{live?.respiratoryRate ?? "—"}</b>
                        </span>
                      </>
                    ) : (
                      <span className="muted">{st.tone === "unknown" ? "" : " "}</span>
                    )}
                  </div>
                  {note && (
                    <span className="elder-note">
                      {(note.attentionReasons ?? []).map((r) => ATTENTION_REASON[r] ?? r).join("、") || note.attentionConclusion}
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>
      )}

      <aside className="care-side">
        <section>
          <div className="side-head">
            <h2>待处理</h2>
            <span className="muted">共 {alerts.total} 条</span>
          </div>
          {alerts.list.length === 0 ? (
            <p className="muted">暂时没有需要处理的告警</p>
          ) : (
            <div className="alert-list">
              {alerts.list.slice(0, 8).map((a) => {
                const who = a.members?.map((x) => x.realName).join("、");
                return (
                  <article key={a.id} className="alert-item">
                    <div className="alert-top">
                      <b>{a.alertTypeName}</b>
                      <span>{sinceText(a.createdAt, now)}</span>
                    </div>
                    <div className="alert-where">{[who, alertLocation(a)].filter(Boolean).join(" · ") || "位置未配置"}</div>
                    <Button size="small" type="primary" danger className="alert-btn" onClick={() => setProcessing(a)}>
                      处理
                    </Button>
                  </article>
                );
              })}
              {alerts.total > 8 && <p className="muted">还有 {alerts.total - 8} 条更早的告警</p>}
            </div>
          )}
        </section>

        <section>
          <div className="side-head">
            <h2>今日需关注</h2>
            <span className="muted">来自昨夜监测</span>
          </div>
          {attention.items.length === 0 ? (
            <p className="muted">今天没有需要特别关注的长者</p>
          ) : (
            <ul className="attention-list">
              {attention.items.map((a) => (
                <li key={a.memberId}>
                  <span className="elder-avatar small">{(a.realName ?? "?").charAt(0)}</span>
                  <span>
                    <b>{a.realName ?? "未命名长者"}</b>
                    <small>{(a.attentionReasons ?? []).map((r) => ATTENTION_REASON[r] ?? r).join("、") || a.attentionConclusion}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
