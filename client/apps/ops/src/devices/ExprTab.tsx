import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Tag, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { DeleteOutlined } from "@ant-design/icons";
import type { Radar } from "../api/device";
import { getCodes, type CodeOption } from "../api/member";
import { verifyExpression } from "../api/scene";

/**
 * 表达式实验：在设备上当场求值场景表达式，摸清函数、变量和数据的样子（见 docs/site-analysis.md"场景表达式"）。
 * 不保存场景，不影响设备上的场景。每行一条，按顺序逐条发。
 */

/** 条件属性字典（值是属性名，表达式里用"属性名_data"）：6 型 SCENE_QL_RADAR，13 型 SCENE_CONDITION_ULTRA_FALL，15 型 SCENE_CONDITION_ULTRA */
const PROP_DICT: Record<number, string> = { 6: "SCENE_QL_RADAR", 13: "SCENE_CONDITION_ULTRA_FALL", 15: "SCENE_CONDITION_ULTRA" };
/** 函数字典按参数个数分：3 个 F(arr, start, end)；5 个 F(arr, op, value, start, end)；7 个 F(arr, op, value, count_op, count_value, start, end) */
const FUNC_DICTS: [string, string][] = [
  ["SCENE_THREE_PARAMS", "(arr, start, end)"],
  ["SCENE_FIVE_PARAMS", '(arr, "op", value, start, end)'],
  ["SCENE_SEVEN_PARAMS", '(arr, "op", value, "count_op", count_value, start, end)'],
];
const OPS = ['"=="', '"!="', '">="', '"<="', '">"', '"<"', "and", "or", "len()", "[:5]", "[-5:]"];

/** 6 型实测过的写法（2026-10-22 坐起测试） */
const EXAMPLES = [
  "QL_fall_state_data",
  "QL_event_area_ID_data",
  "[len(x) for x in QL_fall_state_data]",
  "QL_human_quantity_data[:10]",
  'COUNT_2D(QL_fall_state_data,"==",3,">=",1,0,5)',
];

interface Run {
  at: number;
  expression: string;
  result?: string;
  /** 请求本身出错（设备不在线、平台报错等） */
  error?: string;
  ms?: number;
  pending?: boolean;
}

const HISTORY_KEY = "ops:expr-history";
const HISTORY_MAX = 100;
const loadHistory = (): Run[] => {
  try {
    return (JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as Run[]).filter((r) => !r.pending);
  } catch {
    return [];
  }
};
const saveHistory = (runs: Run[]) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(runs.filter((r) => !r.pending).slice(0, HISTORY_MAX)));
  } catch {
    /* 本机存不了就不存 */
  }
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function status(r: Run) {
  if (r.pending) return <Tag bordered={false}>求值中…</Tag>;
  if (r.error) return <Tag color="error" bordered={false}>请求失败</Tag>;
  if (r.result === undefined) return <Tag color="warning" bordered={false}>没有回报</Tag>;
  if (/Error$/.test(r.result)) return <Tag color="orange" bordered={false}>函数报错</Tag>;
  return <Tag color="success" bordered={false}>结果</Tag>;
}

export default function ExprTab({ d, online }: { d: Radar; online: boolean }) {
  const [text, setText] = useState("");
  const [runs, setRuns] = useState<Run[]>(loadHistory);
  const [busy, setBusy] = useState(false);
  const [props, setProps] = useState<CodeOption[]>([]);
  const [funcs, setFuncs] = useState<{ name: string; label: string; sig: string }[]>([]);
  const ref = useRef<TextAreaRef>(null);

  useEffect(() => {
    const dict = d.deviceType !== undefined ? PROP_DICT[d.deviceType] : undefined;
    if (dict) getCodes(dict).then((list) => setProps(list.filter((p) => !p.value.startsWith("sys_"))), () => setProps([]));
    Promise.all(FUNC_DICTS.map(([code, sig]) => getCodes(code).then((list) => list.map((f) => ({ name: f.value, label: f.label, sig })))))
      .then((all) => setFuncs(all.flat()))
      .catch(() => {});
  }, [d.deviceType]);

  useEffect(() => saveHistory(runs), [runs]);

  /** 在光标处插入 */
  function insert(s: string) {
    const el = ref.current?.resizableTextArea?.textArea;
    const a = el?.selectionStart ?? text.length;
    const b = el?.selectionEnd ?? text.length;
    const next = text.slice(0, a) + s + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + s.length, a + s.length);
    });
  }

  async function run() {
    // 每行一条，# 开头的是注释
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (!lines.length || busy) return;
    setBusy(true);
    try {
      for (const expression of lines) {
        const at = Date.now();
        setRuns((rs) => [{ at, expression, pending: true }, ...rs]);
        let done: Run;
        try {
          const r = await verifyExpression(d, expression);
          done = { at, expression, result: r.result, ms: r.ms };
        } catch (e) {
          done = { at, expression, error: errText(e) };
        }
        setRuns((rs) => rs.map((x) => (x.at === at && x.pending ? done : x)));
      }
    } finally {
      setBusy(false);
    }
  }

  const blocked = d.isDisabled ? "设备已停用" : !online ? "设备离线，发了也不会有回报" : undefined;

  return (
    <div className="detail-body">
      <div className="ops-card">
        <h2>表达式实验</h2>
        <p className="muted small">
          让设备当场求值，不保存、不影响设备上的场景。每行一条，按顺序逐条发，# 开头的行跳过；Ctrl + Enter 发送。设备是用 Python 求值的，切片、len() 都能用；
          写错了设备不回任何结果（显示"没有回报"），函数自己出错时返回 …Error 文本。
        </p>
        {blocked && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message={blocked} />}
        <div className="expr-keys">
          {props.length > 0 && (
            <div>
              <span className="muted small">变量</span>
              {props.map((p) => (
                <Tooltip key={p.value} title={`${p.value}_data`}>
                  <Button size="small" onClick={() => insert(`${p.value}_data`)}>
                    {p.label}
                  </Button>
                </Tooltip>
              ))}
            </div>
          )}
          {funcs.length > 0 && (
            <div>
              <span className="muted small">函数</span>
              {funcs.map((f) => (
                <Tooltip key={f.name} title={`${f.label}：${f.name}${f.sig}`}>
                  <Button size="small" className="mono" onClick={() => insert(`${f.name}(`)}>
                    {f.name}
                  </Button>
                </Tooltip>
              ))}
            </div>
          )}
          <div>
            <span className="muted small">符号</span>
            {OPS.map((o) => (
              <Button key={o} size="small" className="mono" onClick={() => insert(o === "len()" ? "len(" : o)}>
                {o}
              </Button>
            ))}
          </div>
          <div>
            <span className="muted small">示例</span>
            {EXAMPLES.map((e) => (
              <Button key={e} size="small" type="dashed" className="mono" onClick={() => setText(e)}>
                {e}
              </Button>
            ))}
          </div>
        </div>
        <Input.TextArea
          ref={ref}
          className="mono"
          spellCheck={false}
          autoSize={{ minRows: 3, maxRows: 12 }}
          placeholder={'例如 COUNT_2D(QL_fall_state_data,"==",3,">=",1,0,5)'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              run();
            }
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Button type="primary" loading={busy} disabled={!text.trim()} onClick={run}>
            发给设备求值
          </Button>
          <span className="muted small" style={{ alignSelf: "center" }}>
            一条约 1～2 秒；结果从通信日志里按 seq 取，最多等 15 秒
          </span>
        </div>
      </div>

      <div className="ops-card">
        <h2>
          结果
          <span className="muted small" style={{ fontWeight: 400 }}>
            点一条放回输入框；记录存在本机，所有设备共用
          </span>
          <Button size="small" type="text" icon={<DeleteOutlined />} style={{ marginLeft: "auto" }} disabled={!runs.length || busy} onClick={() => setRuns([])}>
            清空
          </Button>
        </h2>
        {!runs.length && <p className="muted small">还没有发过表达式。</p>}
        <ul className="expr-runs">
          {runs.map((r) => (
            <li key={`${r.at}-${r.expression}`} onClick={() => setText(r.expression)} title="放回输入框">
              <div className="expr-run-head">
                <span className="muted small">{clock(r.at)}</span>
                {status(r)}
                {r.ms !== undefined && <span className="muted small">{(r.ms / 1000).toFixed(1)} 秒</span>}
                <code className="mono">{r.expression}</code>
              </div>
              {(r.result !== undefined || r.error) && <pre className={`mono expr-result${r.error ? " err-text" : ""}`}>{r.error ?? r.result}</pre>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
