import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Checkbox, Progress } from "antd";
import { CheckOutlined, CheckCircleFilled, CloseOutlined, DownOutlined, InfoCircleOutlined, MinusOutlined, QuestionCircleOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useGuide } from "./GuideContext";
import type { Step } from "./steps";
import "./guide.css";

/** 每步默认列出的条数，多的折叠 */
const ITEMS_SHOWN = 6;

/** 浮窗位置（离页面区右边、上边多少像素），记在本机。默认在右上角，让开页面标题栏 */
const POS_KEY = "ops:guide:pos";
type Pos = { right: number; top: number };
const DEFAULT_POS: Pos = { right: 12, top: 72 };
function readPos(): Pos {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null") as Pos | null;
    return p && Number.isFinite(p.right) && Number.isFinite(p.top) ? p : DEFAULT_POS;
  } catch {
    return DEFAULT_POS;
  }
}

/**
 * 快速开始清单：浮在页面右上角的小窗，按住标题栏可以拖到别处。
 * 收起后只剩一条进度和下一步，点一下展开；关掉后点侧栏入口再打开。跳到页面操作时清单还开着。
 */
export function GuideDrawer({ orgName }: { orgName: string }) {
  const g = useGuide();
  const [expanded, setExpanded] = useState<string>();
  const [all, setAll] = useState<Set<string>>(new Set());
  /** 用户拖到的位置；实际显示的位置（shown）在放不下时往里挪，收起后再回到这里 */
  const [pos, setPos] = useState<Pos>(readPos);
  const [shown, setShown] = useState<Pos>(pos);
  const ref = useRef<HTMLElement>(null);
  /** 刚拖完：松手时的 click 不算点击 */
  const dragged = useRef(false);
  const steps = g?.steps ?? [];
  const current = steps.find((s) => s.status !== "done");
  // 默认展开第一步没完成的；用户手动点过就按用户的
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setExpanded(current?.key);
  }, [current?.key, touched]);

  /** 不让浮窗跑出页面区：拖到底部再展开时整个往上挪，窗口变小时往里挪 */
  const clamp = useCallback((p: Pos): Pos => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return p;
    return {
      right: Math.round(Math.max(0, Math.min(p.right, parent.clientWidth - el.offsetWidth))),
      top: Math.round(Math.max(0, Math.min(p.top, parent.clientHeight - el.offsetHeight))),
    };
  }, []);
  const open = !!g?.open;
  const mini = !!g?.mini;
  useLayoutEffect(() => {
    if (!open) return;
    const fix = () =>
      setShown((cur) => {
        const n = clamp(pos);
        return n.right === cur.right && n.top === cur.top ? cur : n;
      });
    fix();
    // 展开某一步、检查结果出来时浮窗会变高，也要重新算
    const ro = new ResizeObserver(fix);
    const el = ref.current;
    if (el) ro.observe(el);
    if (el?.offsetParent) ro.observe(el.offsetParent);
    return () => ro.disconnect();
  }, [open, mini, pos, clamp]);

  /** 按住标题栏（收起时整条）拖动；点在按钮上不拖 */
  function onDragStart(e: React.PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button:not(.guide-mini-body)")) return;
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const pr = parent.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const dx = r.right - e.clientX;
    const dy = e.clientY - r.top;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let last = pos;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      last = clamp({ right: pr.right - ev.clientX - dx, top: ev.clientY - dy - pr.top });
      setPos(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return;
      dragged.current = true;
      setTimeout(() => (dragged.current = false));
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(last));
      } catch {
        /* 记不住就只在本次生效 */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (!g?.open) return null;
  const total = steps.length || 7;
  const checked = g.checkedAt ? `${dayjs(g.checkedAt).fromNow()}检查` : "";
  const style = { right: shown.right, top: shown.top };
  const closeTitle = "关闭（点侧栏的快速开始再打开）";

  if (g.mini)
    return (
      <aside ref={ref} className="guide-panel mini" aria-label="快速开始" style={style} onPointerDown={onDragStart}>
        <button className="guide-mini-body" title="展开清单" onClick={() => !dragged.current && g.setMini(false)}>
          <ProgressRing done={g.doneCount} total={total} />
          <span className="guide-step-main">
            <b>快速开始</b>
            <small>{current ? `下一步：${current.title}` : "配置都完成了"}</small>
          </span>
        </button>
        <Button type="text" size="small" icon={<DownOutlined />} title="展开" onClick={() => g.setMini(false)} />
        <Button type="text" size="small" icon={<CloseOutlined />} title={closeTitle} onClick={() => g.setOpen(false)} />
      </aside>
    );

  return (
    <aside ref={ref} className="guide-panel" aria-label="快速开始" style={style}>
      <div className="guide-head" onPointerDown={onDragStart}>
        <div className="guide-title">
          <b>快速开始</b>
          <span className="muted">· {orgName}</span>
          <span className="grow" />
          <Button type="text" size="small" icon={<ReloadOutlined spin={g.loading} />} title="重新检查" onClick={() => g.refresh(true)} />
          <Button type="text" size="small" icon={<MinusOutlined />} title="收起" onClick={() => g.setMini(true)} />
          <Button type="text" size="small" icon={<CloseOutlined />} title={closeTitle} onClick={() => g.setOpen(false)} />
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
        {!current && steps.length > 0 && (
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

/** 进度环：中间是已完成几步 */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r={r} fill="none" stroke="#E4E6EF" strokeWidth="3" />
      <circle cx="16" cy="16" r={r} fill="none" stroke="#3B4FD8" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(done / total) * c} ${c}`} transform="rotate(-90 16 16)" />
      <text x="16" y="20" textAnchor="middle" fontSize="11" fill="currentColor">
        {done}
      </text>
    </svg>
  );
}

/** 侧栏底部的入口：进度环 + "快速开始"；全部完成后收成"帮助"。清单收成一条时点它是展开 */
export function GuideRailEntry() {
  const g = useGuide();
  if (!g) return null;
  const total = g.steps.length || 7;
  return (
    <button
      className={`rail-item guide-rail${g.open ? " active" : ""}`}
      onClick={() => (g.open && g.mini ? g.setMini(false) : g.setOpen(!g.open))}
      title={g.complete ? "快速开始（已全部完成）" : `快速开始：${g.doneCount} / ${total} 已完成`}
    >
      {g.complete ? <QuestionCircleOutlined /> : <ProgressRing done={g.doneCount} total={total} />}
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
