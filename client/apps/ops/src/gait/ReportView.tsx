import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { App, Button, Empty, Spin } from "antd";
import { ArrowLeftOutlined, DownloadOutlined } from "@ant-design/icons";
import { getGaitReport, type GaitReport, type Range } from "../api/gait";
import { saveBlob } from "../members/xlsx";
import { reportToPdf } from "./pdf";
import { buildReport, LEVEL_TEXT, type AdviceBlock, type InlineText, type Metric, type Reading, type ReportModel } from "./reportModel";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** AI 建议是生成完才有的：生成中时隔一会儿重取一次报告 */
const AI_POLL_MS = 5000;
const AI_WAIT_MS = 120_000;
const DISCLAIMER = "本报告仅供临床参考，不构成最终诊断依据";

/** 步态报告：在采集记录模块里全屏打开（运维端不开子标签）。页面就是一张 A4 宽的纸，下载的 PDF 和看到的一样 */
export function ReportView({ segmentId, reportNo, onBack }: { segmentId: string; reportNo?: string; onBack: () => void }) {
  const { message } = App.useApp();
  const [data, setData] = useState<GaitReport | null>();
  const [aiTimedOut, setAiTimedOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const paper = useRef<HTMLElement>(null);

  const load = useCallback(
    () =>
      getGaitReport(segmentId).then(
        (d) => setData(d ?? null),
        (e) => {
          setData((old) => old ?? null);
          message.error(`加载报告失败：${errText(e)}`);
        },
      ),
    [segmentId, message],
  );

  useEffect(() => {
    setData(undefined);
    setAiTimedOut(false);
    load();
  }, [load]);

  const model = useMemo(() => data && buildReport(data, { reportNo, aiTimedOut }), [data, reportNo, aiTimedOut]);
  const pending = !!model?.pendingAi;
  const deadline = data?.aiAnalysisDeadlineAt;

  useEffect(() => {
    if (!pending) return;
    const left = deadline ? Date.parse(deadline) - Date.now() : AI_WAIT_MS;
    const stop = window.setTimeout(() => setAiTimedOut(true), Number.isFinite(left) ? Math.max(0, left) : AI_WAIT_MS);
    const poll = window.setInterval(load, AI_POLL_MS);
    return () => {
      window.clearTimeout(stop);
      window.clearInterval(poll);
    };
  }, [pending, deadline, load]);

  async function download() {
    if (!model || !paper.current) return;
    setSaving(true);
    try {
      const p = model.patient;
      const pdf = await reportToPdf(paper.current, `报告编号 ${p.reportNo}　${DISCLAIMER}`);
      const name = `${p.name}-${p.date}-步态报告.pdf`.replace(/[\\/:*?"<>|]/g, "_");
      saveBlob(new Blob([pdf as BlobPart], { type: "application/pdf" }), name);
      message.success("已开始下载 PDF");
    } catch (e) {
      message.error(`下载失败：${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="gait-report-page">
      <div className="gait-report-bar">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回
        </Button>
        <span style={{ flex: 1 }} />
        <Button type="primary" icon={<DownloadOutlined />} disabled={!model} loading={saving} onClick={download}>
          下载 PDF
        </Button>
      </div>
      <div className="gait-report-scroll">
        {data === undefined ? (
          <Spin style={{ display: "block", margin: "80px auto" }} />
        ) : !model ? (
          <Empty style={{ marginTop: 120 }} description="这条记录没有报告数据" />
        ) : (
          <ReportPaper paperRef={paper} m={model} />
        )}
      </div>
    </div>
  );
}

function ReportPaper({ m, paperRef }: { m: ReportModel; paperRef: Ref<HTMLElement> }) {
  const p = m.patient;
  return (
    <article className="gr-paper" ref={paperRef}>
      <header className="gr-hero" data-pdf-block>
        <div className="gr-hero-top">
          <div>
            <h1>步态分析报告</h1>
            <p>步态筛查与跌倒风险评估</p>
          </div>
          <dl className="gr-hero-meta">
            <dt>报告编号</dt>
            <dd>{p.reportNo}</dd>
            <dt>检测日期</dt>
            <dd>{p.date}</dd>
          </dl>
        </div>
        <div className="gr-person">
          <b>{p.name}</b>
          <span>{p.gender}</span>
          <span>{p.age}</span>
          <span>身高 {p.height}</span>
          <span>体重 {p.weight}</span>
        </div>
      </header>

      <section className="gr-verdict" data-pdf-block>
        <div className="gr-verdict-cell">
          <span className="gr-cell-label">综合评分</span>
          <strong className={`gr-big ${m.score.level}`}>
            {m.score.value}
            <small>分</small>
          </strong>
          <span className="gr-cell-note">{LEVEL_TEXT[m.score.level]}，参考 ≥80 分</span>
        </div>
        <div className="gr-verdict-cell">
          <span className="gr-cell-label">跌倒风险</span>
          <strong className={`gr-big risk-${m.risk.level}`}>{m.risk.text}</strong>
          <span className="gr-cell-note">{m.risk.score != null ? `风险分 ${m.risk.score}` : "没有风险分"}</span>
        </div>
        <div className="gr-verdict-cell wide">
          <span className="gr-cell-label">超出参考范围的指标</span>
          {m.attention.length ? (
            <div className="gr-attention">
              {m.attention.map((a) => (
                <span key={a.title} className={a.high ? "high" : "low"}>
                  {a.title}
                  {a.low && a.high ? " ↕" : a.high ? " ↑" : " ↓"}
                </span>
              ))}
            </div>
          ) : (
            <span className="gr-cell-ok">全部在参考范围内</span>
          )}
        </div>
      </section>

      <section className="gr-advice" data-pdf-block>
        <h2>综合分析与建议</h2>
        {m.analysis.map((b, i) => (
          <Advice key={i} b={b} />
        ))}
      </section>

      <div className="gr-legend" data-pdf-block>
        <h2>详细指标</h2>
        <span className="gr-legend-items">
          <i className="gr-mark left">左</i> 左脚
          <i className="gr-mark right">右</i> 右脚
          <i className="gr-legend-band" /> 参考范围
        </span>
      </div>

      {m.groups.map((g) => (
        <section key={g.title} className="gr-group" data-pdf-block>
          <h3>{g.title}</h3>
          <div className="gr-row gr-head">
            <span>指标</span>
            <span>左脚</span>
            <span>右脚</span>
            <span>和参考范围对比</span>
            <span>对称性</span>
            <span>参考范围</span>
          </div>
          {g.metrics.map((x) => (
            <MetricRow key={x.title} x={x} />
          ))}
        </section>
      ))}

      <footer className="gr-foot" data-pdf-skip>
        {DISCLAIMER}
      </footer>
    </article>
  );
}

function Inline({ t }: { t: InlineText }) {
  return (
    <>
      {t.map((x, i) => (x.bold ? <strong key={i}>{x.text}</strong> : <span key={i}>{x.text}</span>))}
    </>
  );
}

function Advice({ b }: { b: AdviceBlock }) {
  if (b.kind === "heading" || b.kind === "para") {
    const Tag = b.kind === "heading" ? "h4" : "p";
    return (
      <Tag>
        <Inline t={b.text} />
      </Tag>
    );
  }
  const items = b.items.map((t, i) => (
    <li key={i}>
      <Inline t={t} />
    </li>
  ));
  return b.kind === "ol" ? <ol start={b.start}>{items}</ol> : <ul>{items}</ul>;
}

function MetricRow({ x }: { x: Metric }) {
  return (
    <div className="gr-row">
      <span className="gr-name">{x.title}</span>
      {x.value ? (
        <span className="gr-span2">
          <Value r={x.value} />
        </span>
      ) : (
        <>
          <span>
            <Value r={x.left} plain={x.plain} />
          </span>
          <span>
            <Value r={x.right} plain={x.plain} />
          </span>
        </>
      )}
      <span>
        {x.total ? (
          <span className="gr-total">
            合计 {x.total.value} {x.total.unit}
          </span>
        ) : (
          <Track x={x} />
        )}
      </span>
      <span>{x.symmetry ? <Value r={x.symmetry} /> : <span className="gr-dash">-</span>}</span>
      <span className="gr-ref">{x.reference}</span>
    </div>
  );
}

function Value({ r, plain }: { r?: Reading; plain?: boolean }) {
  if (!r) return null;
  const off = !plain && r.level !== "normal";
  return (
    <span className={`gr-value${off ? ` ${r.level}` : ""}`}>
      <b>{r.value}</b>
      {r.value !== "-" && r.unit && <small>{r.unit}</small>}
      {off && <em>{r.level === "high" ? "↑ 偏高" : "↓ 偏低"}</em>}
    </span>
  );
}

/** 范围条：中间的色带是参考范围，左脚标记在线上方、右脚在下方，靠得再近也不重叠 */
function Track({ x }: { x: Metric }) {
  const r = x.range;
  const vals = [x.value?.raw, x.left?.raw, x.right?.raw].filter((v): v is number => v != null && Number.isFinite(v));
  if (!r || !vals.length) return <span className="gr-dash">-</span>;
  const pos = position(r, vals);
  return (
    <span className="gr-track">
      <i className="gr-rail" />
      <i className="gr-band" style={{ left: `${pos(r.min)}%`, width: `${pos(r.max) - pos(r.min)}%` }} />
      {x.value?.raw != null && <i className="gr-mark single" style={{ left: `${pos(x.value.raw)}%` }} />}
      {x.left?.raw != null && (
        <i className="gr-mark left" style={{ left: `${pos(x.left.raw)}%` }}>
          左
        </i>
      )}
      {x.right?.raw != null && (
        <i className="gr-mark right" style={{ left: `${pos(x.right.raw)}%` }}>
          右
        </i>
      )}
    </span>
  );
}

/** 条的两端留出参考范围一半宽的余量，数值超出再往外扩；再留 5% 边距，标记不会探出条外 */
function position(r: Range, vals: number[]) {
  const span = r.max - r.min || Math.abs(r.max) || 1;
  const lo = Math.min(r.min - span / 2, ...vals);
  const hi = Math.max(r.max + span / 2, ...vals);
  return (v: number) => 5 + ((v - lo) / (hi - lo)) * 90;
}
