import { useEffect, useState } from "react";
import { Button, Checkbox, Progress } from "antd";
import { CheckOutlined, CheckCircleFilled, CloseOutlined, InfoCircleOutlined, QuestionCircleOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useGuide } from "./GuideContext";
import type { Step } from "./steps";
import "./guide.css";

/** 每步默认列出的条数，多的折叠 */
const ITEMS_SHOWN = 6;

/** 快速开始清单：和页面并排的右侧面板（不遮页面，跳过去操作时清单还开着） */
export function GuideDrawer({ orgName }: { orgName: string }) {
  const g = useGuide();
  const [expanded, setExpanded] = useState<string>();
  const [all, setAll] = useState<Set<string>>(new Set());
  const steps = g?.steps ?? [];
  const current = steps.find((s) => s.status !== "done")?.key;
  // 默认展开第一步没完成的；用户手动点过就按用户的
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setExpanded(current);
  }, [current, touched]);

  if (!g?.open) return null;
  const total = steps.length || 7;
  const checked = g.checkedAt ? `${dayjs(g.checkedAt).fromNow()}检查` : "";

  return (
    <aside className="guide-panel" aria-label="快速开始">
      <div className="guide-head">
        <div className="guide-title">
          <b>快速开始</b>
          <span className="muted">· {orgName}</span>
          <span className="grow" />
          <Button type="text" size="small" icon={<ReloadOutlined spin={g.loading} />} title="重新检查" onClick={() => g.refresh(true)} />
          <Button type="text" size="small" icon={<CloseOutlined />} title="收起" onClick={() => g.setOpen(false)} />
        </div>
        <div className="guide-progress">
          <Progress percent={(g.doneCount / total) * 100} showInfo={false} size="small" strokeColor="#3B4FD8" />
          <span className="muted small">
            {g.doneCount} / {total} 已完成
            {g.loading ? (g.progress ? ` · 检查中 ${g.progress.done}/${g.progress.total}` : " · 检查中") : checked ? ` · ${checked}` : ""}
          </span>
        </div>
        {g.error && <div className="guide-error">检查失败：{g.error}</div>}
      </div>
      <div className="guide-steps">
        {!steps.length && g.loading && <div className="muted small" style={{ padding: 16 }}>正在检查本机构的配置…</div>}
        {current === undefined && steps.length > 0 && (
          <div className="guide-complete">
            <CheckCircleFilled /> 配置都完成了，可以进监控模式开始值守
          </div>
        )}
        {steps.map((s, i) => (
          <StepRow
            key={s.key}
            step={s}
            n={i + 1}
            open={expanded === s.key}
            showAll={all.has(s.key)}
            onToggle={() => {
              setTouched(true);
              setExpanded(expanded === s.key ? undefined : s.key);
            }}
            onShowAll={() => setAll((x) => new Set(x).add(s.key))}
          />
        ))}
      </div>
      <div className="guide-foot">
        <Checkbox checked={g.hidden} onChange={(e) => g.setHidden(e.target.checked)}>
          <span className="small">不再自动弹出和提示下一步</span>
        </Checkbox>
      </div>
    </aside>
  );
}

function StepRow({ step: s, n, open, showAll, onToggle, onShowAll }: { step: Step; n: number; open: boolean; showAll: boolean; onToggle: () => void; onShowAll: () => void }) {
  const g = useGuide()!;
  const todo = s.items.filter((x) => !x.tip);
  const tips = s.items.filter((x) => x.tip);
  const list = [...todo, ...tips];
  const shown = showAll ? list : list.slice(0, ITEMS_SHOWN);
  return (
    <div className={`guide-step ${s.status}${open ? " open" : ""}`}>
      <button className="guide-step-head" onClick={onToggle} aria-expanded={open}>
        <span className={`guide-ic ${s.status}`}>{s.status === "done" ? <CheckOutlined /> : s.status === "unknown" ? <QuestionCircleOutlined /> : n}</span>
        <span className="guide-step-main">
          <b>{s.title}</b>
          <small>{s.summary}</small>
        </span>
        <RightOutlined className="guide-chev" />
      </button>
      {open && (
        <div className="guide-step-body">
          {s.status !== "done" && <p className="guide-why">{s.why}</p>}
          {shown.length > 0 && (
            <ul className="guide-items">
              {shown.map((it, k) => (
                <li key={k} className={it.tip ? "tip" : ""}>
                  {it.target ? (
                    <button onClick={() => g.go(it.target!)} title="点击跳过去">
                      {it.text}
                    </button>
                  ) : (
                    <span>{it.text}</span>
                  )}
                </li>
              ))}
              {list.length > shown.length && (
                <li>
                  <button className="more" onClick={onShowAll}>
                    还有 {list.length - shown.length} 项，全部显示
                  </button>
                </li>
              )}
            </ul>
          )}
          {s.note && (
            <p className="guide-note">
              <InfoCircleOutlined /> {s.note}
            </p>
          )}
          <Button size="small" type={s.status === "done" ? "default" : "primary"} onClick={() => g.go(s.action.target)}>
            {s.action.label}
          </Button>
        </div>
      )}
    </div>
  );
}

/** 侧栏底部的入口：进度环 + "快速开始"；全部完成后收成"帮助" */
export function GuideRailEntry() {
  const g = useGuide();
  if (!g) return null;
  const total = g.steps.length || 7;
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <button className={`rail-item guide-rail${g.open ? " active" : ""}`} onClick={() => g.setOpen(!g.open)} title={g.complete ? "快速开始（已全部完成）" : `快速开始：${g.doneCount} / ${total} 已完成`}>
      {g.complete ? (
        <QuestionCircleOutlined />
      ) : (
        <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r={r} fill="none" stroke="#E4E6EF" strokeWidth="3" />
          <circle cx="16" cy="16" r={r} fill="none" stroke="#3B4FD8" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(g.doneCount / total) * c} ${c}`} transform="rotate(-90 16 16)" />
          <text x="16" y="20" textAnchor="middle" fontSize="11" fill="currentColor">
            {g.doneCount}
          </text>
        </svg>
      )}
      {g.complete ? "帮助" : "快速开始"}
    </button>
  );
}

/** 一步刚完成时，页面顶部的"下一步"提示条（点 × 或跳走就消失） */
export function GuideBanner() {
  const g = useGuide();
  const b = g?.banner;
  if (!g || !b) return null;
  return (
    <div className="guide-banner" role="status">
      <CheckCircleFilled className="ok" />
      <span className="grow">
        <b>{b.done.title}</b>已完成。
        {b.next ? (
          <>
            下一步：<b>{b.next.title}</b> — {b.next.why}
          </>
        ) : (
          "配置都完成了，可以进监控模式开始值守。"
        )}
      </span>
      {b.next && (
        <Button size="small" type="primary" onClick={() => g.go(b.next!.action.target)}>
          {b.next.action.label}
        </Button>
      )}
      <Button size="small" type="link" onClick={() => (g.closeBanner(), g.setOpen(true))}>
        查看清单
      </Button>
      <Button size="small" type="text" icon={<CloseOutlined />} onClick={g.closeBanner} title="关闭" />
    </div>
  );
}
