import { useMemo, useState } from "react";
import { Alert, Button, Empty, Skeleton, Tooltip } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import AttentionRulesDialog from "../care/AttentionRulesDialog";
import { useCare } from "../care/CareContext";
import { alertLocation, careState, sinceText, TONE_STYLE, type CareState } from "../care/state";
import type { Member } from "../care/api";

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
      // 与右侧"今日需关注"同一份名单（规则见 care/attention.ts）
      return attention.has(m.memberId);
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

export default function CareHome() {
  const { s, alerts, members, attention, alertByMember, liveOf, loading, error, now, openElder, process: setProcessing } = useCare();
  const [filter, setFilter] = useState<Filter>("all");
  const [rulesOpen, setRulesOpen] = useState(false);

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
  const visible = rows.filter((r) => match(filter, r.st, r.m, attentionIds));
  const inRoom = rows.filter((r) => r.st.tone !== "idle" && r.st.tone !== "unknown").length;

  return (
    <div className="care">
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
                  onClick={() => openElder(m.memberId)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && openElder(m.memberId)}
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
                      {note.reasons.join(" · ")}
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>

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
            <h2>今日需关注{attention.total ? ` ${attention.total} 位` : ""}</h2>
            <Tooltip title="设置需关注规则">
              <Button type="text" size="small" icon={<SettingOutlined />} onClick={() => setRulesOpen(true)}>
                规则
              </Button>
            </Tooltip>
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
                    <small>{a.reasons.join(" · ")}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
      <AttentionRulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
