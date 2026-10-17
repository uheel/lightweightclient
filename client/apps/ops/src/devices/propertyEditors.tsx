import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, InputNumber, Segmented, Select, Switch, TimePicker, Tooltip } from "antd";
import { DeleteOutlined, PlusOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { getAllDevices, getDeviceTypeMap, getRadarTypes, type AnyDevice, type PropertyDef } from "../api/device";
import ZoneCanvas, { limitOf, type DmRect, type ZoneType } from "./ZoneCanvas";
import { switchMount } from "./mountSwitch";

/**
 * 数组 / JSON 类属性的结构化编辑器：把 [24,90,8,50] 这类数组拆成运维看得懂的一项项设置。
 * 每一位的含义取自平台网页端"存储属性"里对应的专用组件，以及属性字典的 description（2026-10-16 整理，见 docs/site-analysis.md）。
 */

export interface StructuredProps {
  value: unknown;
  onChange: (v: unknown) => void;
  onError: (err?: string) => void;
  disabled: boolean;
  /** 当前所有属性的值（区域画布要用安装配置） */
  ctx: Record<string, unknown>;
  sn: string;
  /** 改另一项属性（区域画布上拖监测范围时改安装配置） */
  setOther?: (name: string, v: unknown) => void;
  /** 改房间布置里的朝向 / 雷达位置（顶装、侧装互换时用），下发成功后写回房间布置 */
  setPlan?: (p: Partial<PlanCtx>) => void;
}

/** ctx 里放房间布置信息的键（不是设备属性），见 PropertyTab 的 plan */
export const PLAN_CTX = "__plan";
export interface PlanCtx {
  /** 房间布置里这台雷达的朝向（1 上 2 右 3 下 4 左） */
  facing?: number;
  /** 房间外框（cm）和雷达在房间里的位置 */
  room?: { width: number; height: number; radar: { x: number; y: number } };
  deviceType?: number;
  /** 这次改了顶装 / 侧装：给用户的提示 */
  mountNotes?: string[];
}

export interface Structured {
  /** 编辑器占满整行（属性名、状态放在上面一行） */
  wide: boolean;
  Editor: (p: StructuredProps) => React.ReactNode;
  /** 一行可读的摘要 */
  summary: (v: unknown) => string;
  /** 改了哪几项（确认框里逐项列出） */
  diff?: (a: unknown, b: unknown) => string[];
}

// ---------- 通用工具 ----------

/** 值可能是数组，也可能是 JSON 字符串（平台有的记录存成了 "[-50,50,70,500]"） */
export function toArray(v: unknown): unknown[] | undefined {
  let x = v;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return undefined;
    }
  }
  return Array.isArray(x) ? x : undefined;
}

const num = (x: unknown, def: number) => {
  const n = Number(x);
  return x === null || x === undefined || x === "" || !Number.isFinite(n) ? def : n;
};

/** 秒数写成"1 分 40 秒" */
function duration(sec: number) {
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 小时${m % 60 ? ` ${m % 60} 分` : ""}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

function Label({ text, help }: { text: string; help?: string }) {
  return (
    <span className="st-label">
      {text}
      {help && (
        <Tooltip title={help}>
          <QuestionCircleOutlined />
        </Tooltip>
      )}
    </span>
  );
}

// ---------- 定长数字数组：每一位一个字段 ----------

interface Field {
  label: string;
  help?: string;
  kind?: "number" | "switch" | "select";
  /** 原始值的范围 */
  min?: number;
  max?: number;
  /** 显示值 = 原始值 / scale（例如原始单位分米、显示米时 scale = 10；原始单位 10 秒、显示秒时 scale = 0.1） */
  scale?: number;
  unit?: string;
  /** 显示值的小数位 */
  precision?: number;
  step?: number;
  def: number;
  options?: { value: number; label: string }[];
  /** 依赖其他位时禁用（例如坐地告警开着时姿态检测必须开） */
  lockedBy?: (v: number[]) => string | undefined;
  /** 显示值后面的补充说明 */
  hint?: (raw: number) => string | undefined;
  /** 从新的一行开始（把相关的几项排在同一行） */
  newRow?: boolean;
}

/** 一行设置：左边是名称和说明，右边是一句话，数字是字段下标（例如 ["低于", 2, "或高于", 0, "次/分钟时告警"]） */
interface Line {
  label: string;
  desc?: string;
  parts: (number | string)[];
}

interface TupleSpec {
  fields: Field[];
  /** 按句子排的布局；不填时每个字段一行 */
  lines?: Line[];
  /** 显示顺序（数组下标），不填按原顺序 */
  order?: number[];
  /** 允许的数组长度：旧固件位数少时只显示前几位，写回时保持原长度 */
  lengths?: number[];
  /** 原始值 → 字段值（不填时一位对一个字段） */
  decode?: (raw: unknown[] | undefined) => number[];
  encode?: (v: number[]) => unknown;
  /** 改了一位之后联动修正其他位 */
  fix?: (v: number[]) => number[];
  check?: (v: number[]) => string | undefined;
  note?: string;
}

const seconds10: Pick<Field, "scale" | "unit" | "step" | "precision" | "hint"> = {
  scale: 0.1,
  unit: "秒",
  step: 10,
  precision: 0,
  hint: (raw) => (raw * 10 >= 60 ? duration(raw * 10) : undefined),
};

function fieldText(f: Field, raw: number) {
  if (f.kind === "switch") return raw ? "开" : "关";
  if (f.kind === "select") return f.options?.find((o) => o.value === raw)?.label ?? String(raw);
  const shown = f.scale ? +(raw / f.scale).toFixed(f.precision ?? 1) : raw;
  return `${shown}${f.unit ? ` ${f.unit}` : ""}`;
}

function tuple(spec: TupleSpec): Structured {
  const read = (v: unknown) => {
    const raw = toArray(v);
    if (spec.decode) return { vals: spec.decode(raw), fields: spec.fields };
    const n = raw && spec.lengths?.includes(raw.length) ? raw.length : spec.fields.length;
    const fields = spec.fields.slice(0, n);
    return { vals: fields.map((f, i) => num(raw?.[i], f.def)), fields };
  };
  const write = (v: number[]) => (spec.encode ? spec.encode(v) : v);
  const indexes = (fields: Field[]) => (spec.order ?? fields.map((_, i) => i)).filter((i) => i < fields.length);

  return {
    wide: true,
    summary: (v) => {
      if (v === undefined || v === null || v === "") return "—";
      const { vals, fields } = read(v);
      return indexes(fields)
        .map((i) => `${fields[i].label} ${fieldText(fields[i], vals[i])}`)
        .join("，");
    },
    diff: (a, b) => {
      const x = read(a);
      const y = read(b);
      return indexes(y.fields)
        .filter((i) => x.vals[i] !== y.vals[i])
        .map((i) => `${y.fields[i].label}：${x.fields[i] ? fieldText(x.fields[i], x.vals[i]) : "—"} → ${fieldText(y.fields[i], y.vals[i])}`);
    },
    Editor: ({ value, onChange, onError, disabled }) => {
      const { vals, fields } = read(value);
      const set = (i: number, raw: number) => {
        let next = [...vals];
        next[i] = raw;
        if (spec.fix) next = spec.fix(next);
        onError(spec.check?.(next));
        onChange(write(next));
      };
      const err = spec.check?.(vals);
      const raw = toArray(value);
      const empty = !raw || raw.length === 0;
      const lines: Line[] = (
        spec.lines ?? indexes(fields).map((i) => ({ label: fields[i].label, desc: fields[i].help, parts: fields[i].unit ? [i, fields[i].unit!] : [i] }))
      ).filter((l) => l.parts.every((x) => typeof x === "string" || x < fields.length));

      const control = (i: number) => {
        const f = fields[i];
        const v = vals[i];
        if (f.kind === "switch") {
          const locked = f.lockedBy?.(vals);
          return (
            <Tooltip key={i} title={locked}>
              <Switch size="small" checked={!!v} disabled={disabled || !!locked} onChange={(c) => set(i, c ? 1 : 0)} />
            </Tooltip>
          );
        }
        if (f.kind === "select")
          return <Select key={i} size="small" value={v} disabled={disabled} onChange={(x: number) => set(i, x)} options={withUnknown(f.options ?? [], v)} popupMatchSelectWidth={false} style={{ minWidth: 112 }} />;
        const k = f.scale ?? 1;
        return (
          <span key={i} className="pp-num">
            <InputNumber
              size="small"
              value={+(v / k).toFixed(f.precision ?? (k === 1 ? 0 : 1))}
              min={f.min !== undefined ? f.min / k : undefined}
              max={f.max !== undefined ? f.max / k : undefined}
              step={f.step ?? (k > 1 ? 0.1 : 1)}
              precision={f.precision ?? (k === 1 ? 0 : 1)}
              disabled={disabled}
              controls={false}
              onChange={(x) => x !== null && set(i, Math.round(Number(x) * k))}
            />
          </span>
        );
      };
      // 换算提示（例如 100 秒 = 1 分 40 秒）放在句子最后，不打断"数字 + 单位"
      const hints = (l: Line) =>
        l.parts
          .filter((x): x is number => typeof x === "number" && (fields[x].kind ?? "number") === "number")
          .map((i) => fields[i].hint?.(vals[i]))
          .filter(Boolean)
          .join("，");

      return (
        <div className={`pp-lines${empty ? " empty" : ""}`}>
          {empty && <p className="pp-note warn">设备上还没有这一项的值，下面是默认值；改过并下发后才会写入设备。</p>}
          {lines.map((l) => (
            <div key={l.label} className="pp-line">
              <div className="pp-line-text">
                <span>{l.label}</span>
                {l.desc && <small>{l.desc}</small>}
              </div>
              <div className="pp-sentence">
                {l.parts.map((x, j) => (typeof x === "number" ? control(x) : <span key={j}>{x}</span>))}
                {hints(l) && <em className="pp-hint">约 {hints(l)}</em>}
              </div>
            </div>
          ))}
          {spec.note && <p className="pp-note">{spec.note}</p>}
          {spec.lengths && fields.length < spec.fields.length && <p className="pp-note">这台设备的固件只支持上面几项，其余设置需要升级固件。</p>}
          {err && <p className="pp-note err">{err}</p>}
        </div>
      );
    },
  };
}

function withUnknown(options: { value: number; label: string }[], v: number) {
  return options.some((o) => o.value === v) ? options : [...options, { value: v, label: `未知（${v}）` }];
}



// ---------- 各属性的定义 ----------

const breathHeart = (lo: number, hiBreath: number, hiHeart: number): Field[] => [
  { label: "呼吸过高阈值", unit: "次/分", min: lo, max: hiBreath, def: 24, help: "呼吸频率高于这个值时告警" },
  { label: "心率过高阈值", unit: "次/分", min: lo, max: hiHeart, def: 90, help: "心率高于这个值时告警" },
  { label: "呼吸过低阈值", unit: "次/分", min: lo, max: hiBreath, def: 8, help: "呼吸频率低于这个值时告警" },
  { label: "心率过低阈值", unit: "次/分", min: lo, max: hiHeart, def: 50, help: "心率低于这个值时告警", newRow: true },
];

const orderCheck = (v: number[]) =>
  v[2] > v[0] ? "呼吸过低阈值不能大于呼吸过高阈值" : v[3] > v[1] ? "心率过低阈值不能大于心率过高阈值" : undefined;

const weakTime: Field = { label: "生命体征弱检测时间", unit: "分钟", min: 1, max: 15, def: 10, help: "生命体征持续偏弱多久后判定，1～15 分钟" };
const weakSens: Field = { label: "生命体征弱检测灵敏度", min: 1, max: 99, def: 5, help: "1～99，越大越灵敏，但越容易误报，建议不超过 50" };

/** AIO 呼吸心率参数：老固件 4 位，新固件 7 位 */
const QL_RADAR_PARA_TH = tuple({
  fields: [
    ...breathHeart(0, 100, 200),
    { label: "呼吸心率持续测量", kind: "switch", def: 0, help: "开启后设备持续监测呼吸和心率", newRow: true },
    weakTime,
    weakSens,
  ],
  order: [2, 0, 3, 1, 4, 5, 6],
  lengths: [4, 7],
  lines: [
    { label: "呼吸频率", parts: ["低于", 2, "或高于", 0, "次/分钟时告警"] },
    { label: "心率", parts: ["低于", 3, "或高于", 1, "次/分钟时告警"] },
    { label: "持续测量", desc: "开启后一直测量呼吸和心率", parts: [4] },
    { label: "生命体征偏弱", desc: "灵敏度 1～99，越高越容易提醒，也越容易误报，建议不超过 50", parts: ["持续", 5, "分钟时提醒，灵敏度", 6] },
  ],
  check: orderCheck,
});

/** Ultra 呼吸心率阈值 */
const QL_HEALTH_CONFIG = tuple({
  fields: [...breathHeart(1, 255, 255), { ...weakTime, newRow: true }, weakSens],
  order: [2, 0, 3, 1, 4, 5],
  lines: [
    { label: "呼吸频率", parts: ["低于", 2, "或高于", 0, "次/分钟时告警"] },
    { label: "心率", parts: ["低于", 3, "或高于", 1, "次/分钟时告警"] },
    { label: "生命体征偏弱", desc: "灵敏度 1～99，越高越容易提醒，也越容易误报，建议不超过 50", parts: ["持续", 4, "分钟时提醒，灵敏度", 5] },
  ],
  check: orderCheck,
});

const POSTURE_NEEDED = "坐地告警或床上坐起打开时，姿态检测必须打开";
/** 只在姿态检测已经打开时锁住；平台里有违反规则的旧记录（例如 [1,1,0,0,1]），这时要让人能把它打开 */
const postureLock = (v: number[]) => ((v[1] || v[3]) && v[2] ? POSTURE_NEEDED : undefined);

/** Ultra 跌倒参数 */
const QL_FALLDOWN_CONFIG = tuple({
  fields: [
    { label: "疑似跌倒判定时间", min: 1, max: 240, def: 6, ...seconds10, help: "倒地持续多久判定为跌倒，10～2400 秒，按 10 秒取整" },
    { label: "坐地告警", kind: "switch", def: 0, help: "开启后坐在地上超过判定时间会告警，同时会打开姿态检测" },
    { label: "姿态检测", kind: "switch", def: 1, lockedBy: postureLock, help: "检测站、坐、躺等姿态" },
    { label: "床上坐起", kind: "switch", def: 0, help: "开启后输出床上坐起事件，同时会打开姿态检测" },
    { label: "坐地告警判定时间", min: 1, max: 240, def: 6, ...seconds10, help: "坐地持续多久告警，10～2400 秒" },
  ],
  lines: [
    { label: "跌倒", parts: ["倒地超过", 0, "秒判定为跌倒"] },
    { label: "坐地告警", parts: [1, "坐在地上超过", 4, "秒时告警"] },
    { label: "床上坐起", desc: "老人在床上坐起时提醒", parts: [3] },
    { label: "姿态检测", desc: "识别站、坐、躺；坐地告警和床上坐起都要用到", parts: [2] },
  ],
  fix: (v) => (v[1] || v[3] ? Object.assign([...v], { 2: 1 }) : v),
  check: (v) => ((v[1] || v[3]) && !v[2] ? POSTURE_NEEDED : undefined),
});

/** AIO 坐地参数：[开关位, 判定时间]。开关位 bit0 = 坐地告警，bit1 = 姿态检测；坐地告警开时姿态检测必须开（值为 3） */
const QL_RADAR_PARA_SIT = tuple({
  fields: [
    { label: "坐地告警", kind: "switch", def: 0, help: "开启后，在顶装 3×3 米范围内坐地会告警，同时会打开姿态检测" },
    { label: "姿态检测", kind: "switch", def: 0, lockedBy: (v) => (v[0] ? "坐地告警打开时，姿态检测必须打开" : undefined), help: "开启后，在顶装 3×3 米范围内检测坐姿，在监护床范围内输出在床姿态" },
    { label: "坐地告警判定时间", min: 0, max: 999, def: 10, ...seconds10, help: "坐地持续多久告警，按 10 秒取整" },
  ],
  decode: (raw) => {
    const m = num(raw?.[0], 0);
    return [m & 1, m & 1 || (m & 2) >> 1, num(raw?.[1], 10)];
  },
  encode: (v) => [v[0] ? 3 : v[1] ? 2 : 0, v[2]],
  lines: [
    { label: "坐地告警", desc: "顶装时在 3×3 米范围内有效", parts: [0, "坐在地上超过", 2, "秒时告警"] },
    { label: "姿态检测", desc: "识别坐姿和在床姿态；坐地告警要用到", parts: [1] },
  ],
  fix: (v) => (v[0] ? Object.assign([...v], { 1: 1 }) : v),
});

/** slim 设备监测区域：[X 左, X 右, Y 起, Y 止]，单位厘米 */
const RS_AREA = tuple({
  fields: [
    { label: "X 左边界", unit: "米", min: -400, max: 400, scale: 100, precision: 2, def: -50 },
    { label: "X 右边界", unit: "米", min: -400, max: 400, scale: 100, precision: 2, def: 50 },
    { label: "Y 起始（近端）", unit: "米", min: 0, max: 800, scale: 100, precision: 2, def: 50 },
    { label: "Y 结束（远端）", unit: "米", min: 0, max: 800, scale: 100, precision: 2, def: 500 },
  ],
  lines: [
    { label: "左右", desc: "以雷达为中心，左负右正，-4～4 米", parts: ["从", 0, "到", 1, "米"] },
    { label: "远近", desc: "0～8 米", parts: ["离雷达", 2, "到", 3, "米"] },
  ],
  check: (v) => (v[0] >= v[1] ? "左边要小于右边" : v[2] >= v[3] ? "近的一端要小于远的一端" : undefined),
});

/** slim 设备上报频次 */
const RS_REPORT_FREQ = tuple({
  fields: [
    { label: "离线时上报间隔", unit: "秒", min: 0, max: 255, def: 30, help: "平台网页端标为\"离线\"，0～255 秒" },
    { label: "在线时上报间隔", unit: "秒", min: 0, max: 255, def: 1, help: "平台网页端标为\"在线\"，0～255 秒" },
  ],
  lines: [{ label: "上报间隔", desc: "0～255 秒", parts: ["离线时每", 0, "秒，在线时每", 1, "秒一次"] }],
});

const INSTALL_TYPES = [
  { value: 0, label: "顶装" },
  { value: 1, label: "侧装" },
];
const WORK_MODES = [
  { value: 3, label: "人员跟踪" },
  { value: 7, label: "跌倒监测" },
  { value: 11, label: "呼吸睡眠" },
  { value: 15, label: "床位监护" },
];
const dm = { unit: "米", scale: 10, precision: 1, min: -126, max: 126 } as const;

/**
 * 雷达安装配置：[安装方式, 高度(分米), 四个角(分米，第 3/4/2/1 象限：X-Y-, X+Y-, X-Y+, X+Y+), 工作模式]。
 * 四个角总是一个矩形，这里拆成 X / Y 的范围编辑。
 */
const QL_RADAR_CONFIG = tuple({
  fields: [
    { label: "安装方式", kind: "select", options: INSTALL_TYPES, def: 0 },
    { label: "安装高度", unit: "米", scale: 10, precision: 1, min: 0, max: 60, def: 28 },
    { label: "工作模式", kind: "select", options: WORK_MODES, def: 7 },
    { label: "探测范围 X 左", ...dm, def: -30, help: "以雷达为原点，单位米，-12.6～12.6", newRow: true },
    { label: "探测范围 X 右", ...dm, def: 30 },
    { label: "探测范围 Y 下（近）", ...dm, def: -20, newRow: true },
    { label: "探测范围 Y 上（远）", ...dm, def: 20 },
  ],
  decode: (raw) => {
    const r = (i: number, d: number) => num(raw?.[i], d);
    const xs = [r(2, -30), r(4, 30), r(6, -30), r(8, 30)];
    const ys = [r(3, -20), r(5, -20), r(7, 20), r(9, 20)];
    return [r(0, 0), r(1, 28), r(10, 7), Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  },
  encode: ([type, h, mode, x0, x1, y0, y1]) => [type, h, x0, y0, x1, y0, x0, y1, x1, y1, mode],
  lines: [
    { label: "安装方式", parts: [0] },
    { label: "安装高度", desc: "离地面的高度", parts: [1, "米"] },
    { label: "工作模式", parts: [2] },
  ],
  check: (v) => (v[3] >= v[4] || v[5] >= v[6] ? "监测范围不对，请在下面的区域画布里重新拖一下" : undefined),
  note: "监测范围在下面的区域画布里拖虚线框调整。",
});

/** 确认框里的改动说明：监测范围只说大小，不出现坐标 */
const QL_RADAR_CONFIG_FRIENDLY: Structured = {
  ...QL_RADAR_CONFIG,
  // 改安装方式（顶装 / 侧装）时，区域在房间里的位置不变，雷达挪到合适的位置，见 mountSwitch
  Editor: (props) => {
    const { value, onChange, ctx, setOther, setPlan } = props;
    const Base = QL_RADAR_CONFIG.Editor;
    const change = (v: unknown) => {
      const before = toArray(value)?.map((x) => num(x, 0));
      const after = toArray(v)?.map((x) => num(x, 0));
      if (before && after && before.length >= 11 && after.length >= 11 && after[0] !== before[0] && setOther && setPlan) {
        const plan = (ctx[PLAN_CTX] ?? {}) as PlanCtx;
        const res = switchMount({ config: before, area: writeAreas(readAreas(ctx.QL_radar_area)), facing: plan.facing ?? 1, room: plan.room, to: after[0]! });
        onChange(res.config);
        setOther("QL_radar_area", res.area);
        setPlan({ facing: res.facing, room: plan.room && res.radar ? { ...plan.room, radar: res.radar } : plan.room, mountNotes: res.notes });
        return;
      }
      onChange(v);
    };
    return <Base {...props} onChange={change} />;
  },
  diff: (a, b) => {
    const base = QL_RADAR_CONFIG.diff?.(a, b).filter((l) => !l.startsWith("探测范围")) ?? [];
    const ra = toArray(a);
    const rb = toArray(b);
    const x = ra && ra.length >= 10 ? QL_RADAR_CONFIG_DECODE(ra) : undefined;
    const y = rb && rb.length >= 10 ? QL_RADAR_CONFIG_DECODE(rb) : undefined;
    const size = (r: { x0: number; x1: number; y0: number; y1: number }) => `${m1(r.x1 - r.x0)} × ${m1(r.y1 - r.y0)} 米`;
    if (y && (!x || JSON.stringify(x) !== JSON.stringify(y))) base.push(`监测范围：${x ? size(x) : "—"} → ${size(y)}${x && size(x) === size(y) ? "（位置变了）" : ""}`);
    return base;
  },
};

// ---------- 雷达区域 ----------

const AREA_TYPES = [
  { value: 2, label: "普通床" },
  { value: 3, label: "干扰区" },
  { value: 4, label: "门" },
  { value: 5, label: "监护床" },
  { value: 6, label: "感应区" },
  { value: 7, label: "家具" },
];
const AREA_COLOR: Record<number, string> = { 2: "#7C8CF5", 3: "#A0A4B8", 4: "#E09A2D", 5: "#2F9E6B", 6: "#3A86D4", 7: "#B07ACB" };
const areaName = (t: number) => AREA_TYPES.find((a) => a.value === t)?.label ?? `类型 ${t}`;

interface Area {
  id: number;
  type: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** [[编号, 类型, 四个角 8 个坐标(分米)], …]；空数组表示没有配置 */
function readAreas(v: unknown): Area[] {
  return (toArray(v) ?? [])
    .map((row) => toArray(row))
    .filter((r): r is unknown[] => !!r && r.length >= 10)
    .map((r) => {
      const n = r.map((x) => num(x, 0));
      const xs = [n[2], n[4], n[6], n[8]];
      const ys = [n[3], n[5], n[7], n[9]];
      return { id: n[0], type: n[1], x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
}

const writeAreas = (list: Area[]) =>
  [...list].sort((a, b) => a.id - b.id).map((a) => [a.id, a.type, a.x0, a.y0, a.x1, a.y0, a.x0, a.y1, a.x1, a.y1]);

function checkAreas(list: Area[]) {
  const ids = new Set<number>();
  for (const a of list) {
    if (ids.has(a.id)) return `区域编号 ${a.id} 重复`;
    ids.add(a.id);
    if (a.x0 >= a.x1 || a.y0 >= a.y1) return `区域 ${a.id} 的范围不对：左要小于右，下要小于上`;
  }
  if (list.filter((a) => a.type === 5).length > 1) return "监护床只能有一个";
  if (list.length > 16) return "最多 16 个区域";
}

const m1 = (d: number) => (d / 10).toFixed(1);

/** 区域画布上能加的区域：颜色和新加时的大小（平面图上 宽 × 高，分米） */
const CANVAS_TYPES: ZoneType[] = [
  { value: 5, label: "监护床", color: AREA_COLOR[5]!, size: [9, 20] },
  { value: 4, label: "门", color: AREA_COLOR[4]!, size: [9, 1] },
  { value: 6, label: "感应区", color: AREA_COLOR[6]!, size: [10, 10] },
  { value: 2, label: "普通床", color: AREA_COLOR[2]!, size: [9, 20] },
  { value: 7, label: "家具", color: AREA_COLOR[7]!, size: [8, 5] },
  { value: 3, label: "干扰区", color: AREA_COLOR[3]!, size: [10, 10] },
];

const sizeText = (a: Area) => `${m1(a.x1 - a.x0)} × ${m1(a.y1 - a.y0)} 米`;
const inside = (a: Area, b: DmRect) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;

const QL_RADAR_AREA: Structured = {
  wide: true,
  summary: (v) => {
    const list = readAreas(v);
    return list.length ? list.map((a) => `${a.id} ${areaName(a.type)}`).join("，") : "没有区域";
  },
  diff: (a, b) => {
    const x = readAreas(a);
    const y = readAreas(b);
    const out: string[] = [];
    for (const r of y) {
      const o = x.find((q) => q.id === r.id);
      if (!o) out.push(`新增 ${r.id} ${areaName(r.type)}（${sizeText(r)}）`);
      else if (o.type !== r.type) out.push(`${r.id}：${areaName(o.type)} → ${areaName(r.type)}`);
      else if (JSON.stringify(o) !== JSON.stringify(r)) out.push(`${r.id} ${areaName(r.type)}：${sizeText(o) === sizeText(r) ? "相对雷达的位置变了" : `${sizeText(o)} → ${sizeText(r)}`}`);
    }
    for (const o of x) if (!y.some((r) => r.id === o.id)) out.push(`删除 ${o.id} ${areaName(o.type)}`);
    return out;
  },
  Editor: ({ value, onChange, onError, disabled, ctx, setOther, setPlan }) => {
    const list = readAreas(value);
    const plan = (ctx[PLAN_CTX] ?? {}) as PlanCtx;
    const cfgRaw = toArray(ctx.QL_radar_config);
    const cfg = cfgRaw && cfgRaw.length >= 11 ? cfgRaw.map((x) => num(x, 0)) : undefined;
    const installType = cfg?.[0] ?? 0;
    const mode = cfg?.[10] ?? 15;
    const facing = plan.facing && plan.facing >= 1 && plan.facing <= 4 ? plan.facing : 1;
    const bound = cfg ? QL_RADAR_CONFIG_DECODE(cfg) : undefined;
    // 改朝向：区域在房间里的位置不变；侧装时雷达挪到选的那面墙，顶装时雷达原地转向
    const setFacing = (f: number) => {
      if (!cfg || !setOther || !setPlan || f === facing) return;
      const res = switchMount({ config: cfg, area: writeAreas(list), facing, room: plan.room, to: installType, toFacing: f });
      setOther("QL_radar_config", res.config);
      onError(checkAreas(readAreas(res.area)));
      onChange(res.area);
      setPlan({ facing: res.facing, room: plan.room && res.radar ? { ...plan.room, radar: res.radar } : plan.room, mountNotes: res.notes });
    };
    const update = (next: Area[]) => {
      onError(checkAreas(next));
      onChange(writeAreas(next));
    };
    const setBound = (b: DmRect) => {
      if (!cfg || !setOther) return;
      const n = [...cfg];
      [n[2], n[3], n[4], n[5], n[6], n[7], n[8], n[9]] = [b.x0, b.y0, b.x1, b.y0, b.x0, b.y1, b.x1, b.y1];
      setOther("QL_radar_config", n);
    };
    const outside = bound ? list.filter((a) => a.type !== 3 && !inside(a, bound)) : [];
    const err = checkAreas(list) ?? (outside.length ? `${outside.map((a) => `${a.id} ${areaName(a.type)}`).join("、")} 超出了监测范围，设备会忽略超出的部分` : undefined);
    return (
      <div className="st st-area">
        <div className="zc-facing">
          <span>{installType === 1 ? "装在哪面墙" : "雷达朝向"}</span>
          <Segmented
            size="small"
            value={facing}
            disabled={disabled || !cfg || !setPlan}
            onChange={(v) => setFacing(Number(v))}
            options={(installType === 1 ? ["上墙", "右墙", "下墙", "左墙"] : ["朝上", "朝右", "朝下", "朝左"]).map((label, i) => ({ value: i + 1, label }))}
          />
          <small className="muted">{installType === 1 ? "按平面图的上下左右；雷达装在墙的中间，朝房间里看" : "设备正面（箭头）朝平面图的哪一边"}</small>
        </div>
        <ZoneCanvas
          installType={installType}
          facing={facing}
          bound={bound}
          limit={limitOf(installType, mode)}
          zones={list}
          room={plan.room}
          types={CANVAS_TYPES}
          disabled={disabled}
          onZones={update}
          onBound={setOther ? setBound : undefined}
        />
        {plan.mountNotes && plan.mountNotes.length > 0 && (
          <p className="pp-note warn">改了安装方式或朝向：区域在房间里的位置不变，{plan.mountNotes.join("；")}。请确认高度和监测范围后再下发。</p>
        )}
        <p className="pp-note">
          {plan.facing ? "按房间平面图的方向画，粗框是房间的墙。" : "这台雷达不在房间布置里，按默认朝向画。"}区域的编号就是场景规则里引用的区域 ID。
        </p>
        {err && <small className="prop-err">{err}</small>}
      </div>
    );
  },
};

function QL_RADAR_CONFIG_DECODE(raw: unknown[]) {
  const n = raw.map((x) => num(x, 0));
  const xs = [n[2], n[4], n[6], n[8]];
  const ys = [n[3], n[5], n[7], n[9]];
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

// ---------- 离线语音唤醒词 ----------

/** 设备固定支持的 10 个唤醒词和默认灵敏度 / 阈值（取自平台网页端） */
const PRESET_WORDS: [string, number, number][] = [
  ["呼叫护工", 0.25, 0.35],
  ["呼叫护士", 0.25, 0.35],
  ["呼叫儿子", 0.25, 0.35],
  ["呼叫女儿", 0.25, 0.35],
  ["救命", 0.25, 0.4],
  ["别打我", 0.25, 0.35],
  ["救救我", 0.25, 0.35],
  ["有人抽烟", 0.25, 0.35],
  ["打死你", 0.25, 0.35],
  ["操你妈", 0.25, 0.35],
];

/** 报文里中文可能写成 救 或去掉反斜杠的 u6551 */
function unescapeWord(w: string) {
  const s = w.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return /^(u[0-9a-fA-F]{4})+$/.test(s) ? s.replace(/u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : s;
}

interface Word {
  word: string;
  sens: number;
  th: number;
  on: boolean;
}

function readWords(v: unknown): Word[] {
  const raw = toArray(v);
  const got = new Map<string, [number, number]>();
  for (const r of raw ?? []) {
    const a = toArray(r);
    if (a && typeof a[0] === "string") got.set(unescapeWord(a[0]), [num(a[1], 0.25), num(a[2], 0.35)]);
  }
  const list: Word[] = PRESET_WORDS.map(([word, s, t]) => {
    const g = got.get(word);
    return { word, sens: g ? g[0] : s, th: g ? g[1] : t, on: raw ? got.has(word) : true };
  });
  // 预设之外的词（新固件可能有）也保留
  for (const [word, [s, t]] of got) if (!PRESET_WORDS.some((p) => p[0] === word)) list.push({ word, sens: s, th: t, on: true });
  return list;
}

const writeWords = (list: Word[]) => list.filter((w) => w.on).map((w) => [w.word, w.sens, w.th]);

const OFFLSR_KEYWORDS: Structured = {
  wide: true,
  summary: (v) => {
    const on = readWords(v).filter((w) => w.on);
    return on.length ? `已启用 ${on.length} 个：${on.map((w) => w.word).join("、")}` : "—";
  },
  diff: (a, b) => {
    const x = readWords(a);
    const y = readWords(b);
    return y.flatMap((w) => {
      const o = x.find((q) => q.word === w.word);
      if (!o || o.on !== w.on) return [`${w.word}：${w.on ? "启用" : "停用"}`];
      if (w.on && (o.sens !== w.sens || o.th !== w.th)) return [`${w.word}：灵敏度 ${o.sens} → ${w.sens}，阈值 ${o.th} → ${w.th}`];
      return [];
    });
  },
  Editor: ({ value, onChange, onError, disabled }) => {
    const list = readWords(value);
    const set = (i: number, p: Partial<Word>) => {
      const next = list.map((w, j) => (j === i ? { ...w, ...p } : w));
      onError(next.some((w) => w.on) ? undefined : "至少启用 1 个唤醒词");
      onChange(writeWords(next));
    };
    const onCount = list.filter((w) => w.on).length;
    return (
      <div className="st">
        <div className="st-words">
          <div className="st-word head">
            <span>启用</span>
            <span>唤醒词</span>
            <Label text="灵敏度" help="0～1，越小越容易触发" />
            <Label text="阈值" help="0～1，越大越难唤醒。一般只需要调阈值" />
          </div>
          {list.map((w, i) => (
            <div key={w.word} className={`st-word${w.on ? "" : " off"}`}>
              <Checkbox checked={w.on} disabled={disabled || (w.on && onCount <= 1)} onChange={(e) => set(i, { on: e.target.checked })} />
              <span>{w.word}</span>
              <InputNumber size="small" value={w.sens} min={0} max={1} step={0.05} precision={2} disabled={disabled || !w.on} onChange={(x) => x !== null && set(i, { sens: Number(x) })} style={{ width: 84 }} />
              <InputNumber size="small" value={w.th} min={0} max={1} step={0.05} precision={2} disabled={disabled || !w.on} onChange={(x) => x !== null && set(i, { th: Number(x) })} style={{ width: 84 }} />
            </div>
          ))}
        </div>
        <small className="muted">唤醒词是设备固定的 10 个，只能选择启用哪些（至少 1 个）。</small>
      </div>
    );
  },
};

// ---------- 绑定的子设备（蓝牙外设、环境传感器） ----------

/** 列表里的一项：key 用来去重和删除 */
interface Linked {
  key: string;
  sn: string;
  name?: string;
  deviceType?: number;
  /** 写回时的原样数据 */
  raw: unknown;
}

/** 设备类型名、机构设备列表只取一次 */
let typeNames: Promise<Map<number, string>> | undefined;
let orgDevices: Promise<AnyDevice[]> | undefined;

function useTypeNames() {
  const [m, setM] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    typeNames ??= getDeviceTypeMap().catch(() => new Map());
    typeNames.then(setM);
  }, []);
  return m;
}

function linkedDevices(o: { read: (v: unknown) => Linked[]; make: (d: AnyDevice) => unknown; max: number; noun: string }): Structured {
  return {
    wide: true,
    summary: (v) => {
      const l = o.read(v);
      return l.length ? `${l.length} 个：${l.map((x) => x.name || x.sn).join("、")}` : `没有${o.noun}`;
    },
    diff: (a, b) => {
      const x = o.read(a);
      const y = o.read(b);
      return [
        ...y.filter((d) => !x.some((q) => q.key === d.key)).map((d) => `添加 ${d.name || d.sn}`),
        ...x.filter((d) => !y.some((q) => q.key === d.key)).map((d) => `移除 ${d.name || d.sn}`),
      ];
    },
    Editor: function LinkedEditor({ value, onChange, disabled, sn }) {
      const list = o.read(value);
      const names = useTypeNames();
      const [devices, setDevices] = useState<AnyDevice[]>();
      const load = () => {
        // 雷达本身不能当子设备，列表里去掉雷达类的设备
        orgDevices ??= Promise.all([getAllDevices(), getRadarTypes().catch(() => [])])
          .then(([all, radar]) => {
            const r = new Set(radar.map((t) => t.value));
            return all.filter((d) => !r.has(d.deviceType));
          })
          .catch(() => {
            orgDevices = undefined;
            return [];
          });
        orgDevices.then(setDevices);
      };
      const options = useMemo(
        () =>
          (devices ?? [])
            .filter((d) => d.sn !== sn && !list.some((x) => x.sn === d.sn || x.key === d.id))
            .map((d) => ({ value: d.sn, label: `${d.deviceName || d.sn} · ${names.get(d.deviceType) ?? d.deviceType} · ${d.sn}` })),
        [devices, list, names, sn],
      );
      const typeName = (t?: number) => (t ? (names.get(t) ?? `类型 ${t}`) : o.noun);
      return (
        <div className="st">
          <div className="st-chips">
            {list.map((x) => (
              <div key={x.key} className="st-chip">
                <span>
                  <b>{x.name && x.name !== x.sn ? x.name : typeName(x.deviceType)}</b>
                  <small className="mono muted">
                    {x.name && x.name !== x.sn ? `${typeName(x.deviceType)} · ` : ""}
                    {x.sn || x.key}
                  </small>
                </span>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={disabled} title="移除" onClick={() => onChange(list.filter((q) => q.key !== x.key).map((q) => q.raw))} />
              </div>
            ))}
            {!list.length && <small className="muted">没有绑定{o.noun}。</small>}
          </div>
          {list.length < o.max && (
            <Select
              size="small"
              showSearch
              disabled={disabled}
              value={null}
              placeholder={`添加${o.noun}（还可添加 ${o.max - list.length} 个），按名称或 SN 搜索`}
              onFocus={load}
              loading={!devices}
              options={options}
              optionFilterProp="label"
              onChange={(v: string) => {
                const d = devices?.find((x) => x.sn === v);
                if (d) onChange([...list.map((q) => q.raw), o.make(d)]);
              }}
              style={{ width: "100%", maxWidth: 520 }}
            />
          )}
        </div>
      );
    },
  };
}

const objects = (v: unknown) => (toArray(v) ?? []).filter((x): x is Record<string, unknown> => !!x && typeof x === "object");

/** AIO 蓝牙外设：[{slave_ID: SN, slave_type: 类型编号(字符串)}]，最多 19 个 */
const SLAVE_CONFIG = linkedDevices({
  noun: "蓝牙外设",
  max: 19,
  read: (v) =>
    objects(v)
      .filter((x) => x.slave_ID)
      .map((x) => ({ key: String(x.slave_ID), sn: String(x.slave_ID), deviceType: Number(x.slave_type) || undefined, raw: x })),
  make: (d) => ({ slave_ID: d.sn, slave_type: String(d.deviceType) }),
});

/** 环境传感器（平台属性）：[{id: 设备 id, sn, deviceName, deviceType}]，老记录可能只有 id 字符串，最多 99 个 */
const HEIMAN_SLAVE_IDS = linkedDevices({
  noun: "环境传感器",
  max: 99,
  read: (v) =>
    (toArray(v) ?? [])
      .map((x): Linked | undefined => {
        if (typeof x === "string") return x ? { key: x, sn: "", name: x, raw: x } : undefined;
        if (!x || typeof x !== "object") return undefined;
        const o = x as Record<string, unknown>;
        const key = String(o.id ?? o.sn ?? "");
        return key ? { key, sn: String(o.sn ?? o.imei ?? ""), name: o.deviceName ? String(o.deviceName) : undefined, deviceType: Number(o.deviceType) || undefined, raw: x } : undefined;
      })
      .filter((x): x is Linked => !!x),
  make: (d) => ({ id: d.id, sn: d.sn, deviceName: d.deviceName, deviceType: d.deviceType }),
});

// ---------- 时区 ----------

const TZ: [number, string][] = [
  [-720, "贝克岛、豪兰岛"],
  [-660, "美属萨摩亚、纽埃"],
  [-600, "美国夏威夷、法属波利尼西亚"],
  [-570, "法属波利尼西亚马克萨斯群岛"],
  [-540, "美国阿拉斯加"],
  [-480, "美国和加拿大西部"],
  [-420, "美国和加拿大山区"],
  [-360, "美国和加拿大中部、墨西哥"],
  [-300, "美国和加拿大东部、哥伦比亚、秘鲁"],
  [-240, "加拿大大西洋地区、委内瑞拉、玻利维亚"],
  [-210, "加拿大纽芬兰"],
  [-180, "巴西、阿根廷、乌拉圭、智利"],
  [-120, "巴西费尔南多迪诺罗尼亚群岛"],
  [-60, "葡萄牙亚速尔群岛、佛得角"],
  [0, "英国、葡萄牙、爱尔兰、冰岛"],
  [60, "法国、德国、意大利、西班牙、波兰"],
  [120, "芬兰、希腊、埃及、南非、以色列"],
  [180, "俄罗斯莫斯科、土耳其、沙特阿拉伯"],
  [210, "伊朗"],
  [240, "阿联酋、阿曼、格鲁吉亚"],
  [270, "阿富汗"],
  [300, "巴基斯坦、乌兹别克斯坦、哈萨克斯坦"],
  [330, "印度、斯里兰卡"],
  [345, "尼泊尔"],
  [360, "孟加拉国、不丹、吉尔吉斯斯坦"],
  [390, "缅甸"],
  [420, "泰国、越南、柬埔寨、印度尼西亚西部"],
  [480, "中国、新加坡、马来西亚、菲律宾"],
  [525, "澳大利亚尤克拉"],
  [540, "日本、韩国"],
  [570, "澳大利亚中部"],
  [600, "澳大利亚东部、关岛"],
  [630, "澳大利亚豪勋爵岛"],
  [660, "所罗门群岛、新喀里多尼亚"],
  [720, "新西兰、斐济"],
  [765, "新西兰查塔姆群岛"],
  [780, "萨摩亚、汤加"],
  [825, "新西兰查塔姆群岛夏令时"],
  [840, "基里巴斯莱恩群岛"],
];
const utc = (m: number) => `UTC${m >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(m) / 60))}:${pad(Math.abs(m) % 60)}`;
const tzLabel = (m: number) => `${utc(m)} ${TZ.find((t) => t[0] === m)?.[1] ?? ""}`.trim();

/** 时区：设备存的是相对 UTC 的分钟数，不会自动切换夏令时 */
const TZ_OFFSET: Structured = {
  wide: false,
  summary: (v) => (v === undefined || v === null || v === "" ? "—" : tzLabel(num(v, 0))),
  Editor: ({ value, onChange, disabled }) => {
    const v = value === undefined || value === null || value === "" ? undefined : num(value, 0);
    const opts = TZ.map(([m, r]) => ({ value: m, label: `${utc(m)} · ${r}` }));
    if (v !== undefined && !TZ.some((t) => t[0] === v)) opts.push({ value: v, label: `${utc(v)} · 自定义` });
    return (
      <Select
        size="small"
        showSearch
        optionFilterProp="label"
        disabled={disabled}
        value={v}
        placeholder="选择时区"
        options={opts}
        onChange={onChange}
        popupMatchSelectWidth={false}
        style={{ width: 320, maxWidth: "100%" }}
      />
    );
  },
};

// ---------- 时间 / 时间段 ----------

/** 一段时间：[时, 分]～[时, 分]（可跨零点） */
type Range = [[number, number], [number, number]];

/** 时间段属性：AIO 是 ["08:00-20:00", …]，Ultra / slim 是扁平的 [时,分,时,分, …] */
function readRanges(v: unknown, flat: boolean): Range[] {
  const raw = toArray(v) ?? [];
  if (flat) {
    const n = raw.map((x) => num(x, 0));
    const out: Range[] = [];
    for (let i = 0; i + 3 < n.length; i += 4) out.push([[n[i], n[i + 1]], [n[i + 2], n[i + 3]]]);
    return out;
  }
  return raw
    .map((s) => String(s).match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [[+m[1], +m[2]], [+m[3], +m[4]]] as Range);
}

const writeRanges = (list: Range[], flat: boolean) =>
  flat ? list.flatMap(([a, b]) => [a[0], a[1], b[0], b[1]]) : list.map(([a, b]) => `${pad(a[0])}:${pad(a[1])}-${pad(b[0])}:${pad(b[1])}`);

const rangeText = ([a, b]: Range) => `${pad(a[0])}:${pad(a[1])}～${pad(b[0])}:${pad(b[1])}${b[0] * 60 + b[1] < a[0] * 60 + a[1] ? "（次日）" : ""}`;

const dj = (h: number, m: number, s = 0) => dayjs("2024-01-01").hour(h).minute(m).second(s);

function timeRanges(p: PropertyDef): Structured {
  const flat = p.fieldProps?.timeRangeFormat === "H,m";
  const max = p.fieldProps?.timeRangeMaxCount ?? 5;
  /** AIO 的工作时段为空表示全天 */
  const emptyText = p.propertyName === "working_times" && !flat ? "全天" : "未设置";
  return {
    wide: false,
    summary: (v) => {
      const l = readRanges(v, flat);
      return l.length ? l.map(rangeText).join("，") : emptyText;
    },
    Editor: ({ value, onChange, disabled }) => {
      const list = readRanges(value, flat);
      const set = (next: Range[]) => onChange(writeRanges(next, flat));
      return (
        <div className="st st-ranges">
          {list.map((r, i) => (
            <div key={i} className="st-range-row">
              <TimePicker.RangePicker
                size="small"
                format="HH:mm"
                order={false}
                allowClear={false}
                disabled={disabled}
                value={[dj(r[0][0], r[0][1]), dj(r[1][0], r[1][1])]}
                onChange={(v) => {
                  if (!v?.[0] || !v[1]) return;
                  set(list.map((x, j) => (j === i ? ([[v[0]!.hour(), v[0]!.minute()], [v[1]!.hour(), v[1]!.minute()]] as Range) : x)));
                }}
              />
              <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={disabled} title="删除这段" onClick={() => set(list.filter((_, j) => j !== i))} />
            </div>
          ))}
          {!list.length && <small className="muted">{emptyText === "全天" ? "没有设置时段，表示全天工作。" : "没有设置时段。"}</small>}
          {list.length < max && (
            <Button size="small" icon={<PlusOutlined />} disabled={disabled} onClick={() => set([...list, [[8, 0], [20, 0]]])} style={{ alignSelf: "flex-start" }}>
              添加时段
            </Button>
          )}
        </div>
      );
    },
  };
}

/** slim：睡眠报告生成时间 [时, 分, 秒] */
const RS_SLEEP_TIME: Structured = {
  wide: false,
  summary: (v) => {
    const a = toArray(v);
    return a && a.length >= 2 ? `每天 ${pad(num(a[0], 0))}:${pad(num(a[1], 0))}` : "—";
  },
  Editor: ({ value, onChange, disabled }) => {
    const a = toArray(value);
    const t: Dayjs | null = a && a.length >= 2 ? dj(num(a[0], 0), num(a[1], 0), num(a[2], 0)) : null;
    return <TimePicker size="small" format="HH:mm" value={t} disabled={disabled} allowClear={false} onChange={(d) => d && onChange([d.hour(), d.minute(), 0])} />;
  },
};

/** slim：睡眠报告分析时间段 [时,分,秒, 时,分,秒]，通常跨零点（例如 18:00～次日 12:00） */
const RS_SLEEP_SLOT: Structured = {
  wide: false,
  summary: (v) => {
    const a = (toArray(v) ?? []).map((x) => num(x, 0));
    return a.length >= 6 ? rangeText([[a[0], a[1]], [a[3], a[4]]]) : "—";
  },
  Editor: ({ value, onChange, disabled }) => {
    const a = (toArray(value) ?? []).map((x) => num(x, 0));
    const v: [Dayjs, Dayjs] | null = a.length >= 6 ? [dj(a[0], a[1], a[2]), dj(a[3], a[4], a[5])] : null;
    return (
      <TimePicker.RangePicker
        size="small"
        format="HH:mm"
        order={false}
        allowClear={false}
        disabled={disabled}
        value={v}
        onChange={(d) => d?.[0] && d[1] && onChange([d[0].hour(), d[0].minute(), 0, d[1].hour(), d[1].minute(), 0])}
      />
    );
  },
};

/** 疑似跌倒判定时间（AIO）：单个数字，单位 10 秒，0 表示用默认值 60 秒 */
const QL_RADAR_PARA_FALL: Structured = {
  wide: false,
  summary: (v) => {
    const n = num(v, 0);
    return n === 0 ? "默认（60 秒）" : duration(n * 10);
  },
  Editor: ({ value, onChange, disabled }) => {
    const n = num(value, 0);
    return (
      <div className="pp-sentence">
        <span>倒地超过</span>
        <span className="pp-num">
          <InputNumber size="small" value={n * 10} min={0} max={2400} step={10} precision={0} controls={false} disabled={disabled} onChange={(x) => x !== null && onChange(Math.round(Number(x) / 10))} />
        </span>
        <span>秒</span>
        {n === 0 ? <em className="pp-hint">0 表示用默认的 60 秒</em> : n * 10 >= 60 && <em className="pp-hint">约 {duration(n * 10)}</em>}
      </div>
    );
  },
};

// ---------- 入口 ----------

/** Ultra 系列（13 Ultra Fall，15 Ultra Plus）的属性名和 AIO 不同 */
const ULTRA = new Set([13, 15]);
const SLIM = 12;

export function structuredFor(p: PropertyDef, deviceTypeCode?: number): Structured | undefined {
  switch (p.propertyName) {
    case "QL_radar_para_TH":
      return QL_RADAR_PARA_TH;
    case "QL_radar_para_sit":
      return QL_RADAR_PARA_SIT;
    case "QL_radar_para_fall":
      return QL_RADAR_PARA_FALL;
    case "QL_radar_config":
      return QL_RADAR_CONFIG_FRIENDLY;
    case "QL_radar_area":
      return QL_RADAR_AREA;
    case "offlsr_keywords":
      return OFFLSR_KEYWORDS;
    case "slave_config":
      return SLAVE_CONFIG;
    case "heiman_slave_ids":
      return HEIMAN_SLAVE_IDS;
    case "tz_offset":
      return TZ_OFFSET;
  }
  if (deviceTypeCode !== undefined && ULTRA.has(deviceTypeCode)) {
    if (p.propertyName === "QL_health_config") return QL_HEALTH_CONFIG;
    if (p.propertyName === "QL_falldown_config") return QL_FALLDOWN_CONFIG;
  }
  if (deviceTypeCode === SLIM) {
    if (p.propertyName === "rs_area") return RS_AREA;
    if (p.propertyName === "rs_report_freq") return RS_REPORT_FREQ;
    if (p.propertyName === "rs_sleep_time") return RS_SLEEP_TIME;
    if (p.propertyName === "rs_sleep_slot") return RS_SLEEP_SLOT;
  }
  if (p.displayType === 9) {
    // 编辑器是组件，同一个属性要拿到同一个对象，否则每次渲染都会重建
    const key = `${p.propertyName}|${p.fieldProps?.timeRangeFormat ?? ""}|${p.fieldProps?.timeRangeMaxCount ?? ""}`;
    let st = rangeCache.get(key);
    if (!st) rangeCache.set(key, (st = timeRanges(p)));
    return st;
  }
}

const rangeCache = new Map<string, Structured>();
