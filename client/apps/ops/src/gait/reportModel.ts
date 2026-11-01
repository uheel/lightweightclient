import type { ByFoot, GaitReport, Range } from "../api/gait";
import type { GaitSensor } from "../api/gait";

/**
 * 步态报告的显示规则（和网页端报告页一致）：评分、风险、AI 建议取平台算好的；
 * 偏高偏低按参考范围判断，左右对称性 = 100 - 2|左-右|/(左+右)×100（取绝对值，限制在 0～100）。
 */
export type Level = "normal" | "low" | "high";

export interface Reading {
  value: string;
  /** 原始数值，范围条上定位用 */
  raw?: number;
  unit?: string;
  level: Level;
}

export interface Metric {
  title: string;
  reference: string;
  /** 参考范围，范围条用 */
  range?: Range;
  /** 单值，或者左右（加合计 / 对称性） */
  value?: Reading;
  left?: Reading;
  right?: Reading;
  total?: Reading;
  symmetry?: Reading;
  /** 步数没有参考范围，不显示偏高偏低 */
  plain?: boolean;
}

/** AI 建议的一段：平台返回的是 Markdown（标题、1. 列表、- 列表、**粗体**） */
export type InlineText = { text: string; bold?: boolean }[];
export type AdviceBlock =
  | { kind: "heading"; text: InlineText }
  | { kind: "para"; text: InlineText }
  | { kind: "ol"; start: number; items: InlineText[] }
  | { kind: "ul"; items: InlineText[] };

function parseInline(line: string): InlineText {
  // 按 ** 切开，奇数段是粗体；没配对的 ** 和单个 * 直接去掉
  const parts = line.split("**");
  const paired = parts.length % 2 === 1;
  return parts
    .map((text, i) => ({ text: text.replace(/\*/g, ""), bold: paired && i % 2 === 1 }))
    .filter((x) => x.text);
}

/** 只认平台实际用到的写法（2026-11-01 扫过李虎 161 份报告）。"1、" 也算列表；一行里连着写的几条先拆开，3.2km 这种小数不算 */
export function parseAdvice(texts: string[]): AdviceBlock[] {
  const lines = texts
    .flatMap((t) => t.split(/\s*\n+\s*|\s+(?=\d+、|\d+\.\s|\d+\.\*\*)/))
    .map((l) => l.trim())
    .filter(Boolean);
  const blocks: AdviceBlock[] = [];
  for (const line of lines) {
    const last = blocks[blocks.length - 1];
    const heading = /^#{1,6}\s*(.+)$/.exec(line);
    const numbered = /^(\d+)[、.]\s*(.+)$/.exec(line);
    const bullet = /^[-•]\s+(.+)$/.exec(line);
    if (heading) blocks.push({ kind: "heading", text: parseInline(heading[1]) });
    else if (numbered) {
      if (last?.kind === "ol") last.items.push(parseInline(numbered[2]));
      else blocks.push({ kind: "ol", start: Number(numbered[1]), items: [parseInline(numbered[2])] });
    } else if (bullet) {
      if (last?.kind === "ul") last.items.push(parseInline(bullet[1]));
      else blocks.push({ kind: "ul", items: [parseInline(bullet[1])] });
    } else blocks.push({ kind: "para", text: parseInline(line) });
  }
  return blocks;
}

export const LEVEL_TEXT: Record<Level, string> = { normal: "正常", low: "偏低", high: "偏高" };

export function num(v: number | undefined, digits = 0) {
  return v == null || !Number.isFinite(v) ? "-" : String(Number(v.toFixed(digits)));
}

function levelOf(v: number | undefined, r?: Partial<Range>): Level {
  if (v == null || !r) return "normal";
  if (r.min != null && v < r.min) return "low";
  if (r.max != null && v > r.max) return "high";
  return "normal";
}

function reading(v: number | undefined, unit: string, r?: Range, digits = 0): Reading {
  return { value: num(v, digits), raw: v, unit, level: levelOf(v, r) };
}

function symmetryOf(l?: number, r?: number) {
  if (l == null || r == null) return undefined;
  const a = Math.abs(l);
  const b = Math.abs(r);
  if (a + b === 0) return undefined;
  return Math.min(100, Math.max(0, 100 - (2 * Math.abs(a - b)) / (a + b) * 100));
}

const rangeText = (r: Range | undefined, unit: string, digits = 2) => (r ? `${num(r.min, digits)}-${num(r.max, digits)} ${unit}` : "-");

/** 平台老数据的左右脚都是 0、只有合计：当没有分左右 */
function feet(f: ByFoot | undefined, total?: number) {
  const left = f?.left;
  const right = f?.right;
  if ((total ?? 0) > 0 && !left && !right) return { left: undefined, right: undefined };
  return { left, right };
}

function pair(title: string, f: ByFoot | undefined, unit: string, r: Range | undefined, sym: Range | undefined, digits = 0, refDigits = 2): Metric {
  return {
    title,
    reference: rangeText(r, unit, refDigits),
    range: r,
    left: reading(f?.left, unit, r, digits),
    right: reading(f?.right, unit, r, digits),
    symmetry: reading(symmetryOf(f?.left, f?.right), "%", sym, 1),
  };
}

const ratioOf = (len: number | undefined, height: number | undefined) => (len && height ? (len / height) * 100 : undefined);

export interface ReportModel {
  score: Reading;
  /** 左右脚或单值超出参考范围的指标 */
  attention: { title: string; low: boolean; high: boolean }[];
  risk: { text: string; level: Level | "unknown"; score?: number };
  analysis: AdviceBlock[];
  groups: { title: string; metrics: Metric[] }[];
  patient: { name: string; gender: string; age: string; height: string; weight: string; reportNo: string; date: string };
  pendingAi: boolean;
}

export function buildReport(d: GaitReport, opts: { reportNo?: string; aiTimedOut?: boolean } = {}): ReportModel {
  const ref = d.referenceStandard ?? {};
  const speed = d.stepSpeed == null ? undefined : d.stepSpeed / 3.6;
  const speedRange = ref.stepSpeed && { min: ref.stepSpeed.min / 3.6, max: ref.stepSpeed.max / 3.6 };
  const sym = ref.stepSymmetryPercent;
  const score = d.gaitAnalysisResponse?.score;

  // 步幅身高比的参考范围：步幅下限 / 身高上限 ～ 步幅上限 / 身高下限
  const stride = ref.strideLengthCm;
  const ratioRange = stride && ref.minHeight && ref.maxHeight ? { min: (stride.min / ref.maxHeight) * 100, max: (stride.max / ref.minHeight) * 100 } : undefined;
  const ratio: ByFoot = {
    left: ratioOf(d.strideLengthByFoot?.left || d.strideLengthByFoot?.average || d.strideLength, d.height),
    right: ratioOf(d.strideLengthByFoot?.right || d.strideLengthByFoot?.average || d.strideLength, d.height),
  };

  const steps = feet(d.stepCountByFoot, d.stepCount);
  const doubleSupport =
    d.double_support_ratio ??
    (d.strideTime && d.doubleFootSupportTime ? (d.doubleFootSupportTime / d.strideTime) * 100 : Math.max(0, (d.supportPhaseRatio ?? 0) - (d.swingPhaseRatio ?? 0)));

  const groups: ReportModel["groups"] = [
    {
      title: "步态基础指标",
      metrics: [
        {
          title: "步数",
          reference: "暂无",
          plain: true,
          left: reading(steps.left, "步"),
          right: reading(steps.right, "步"),
          total: reading(steps.left != null && steps.right != null ? steps.left + steps.right : d.stepCount, "步"),
        },
        { title: "步频", reference: rangeText(ref.strideFrequencyStepsPerMinute, "步/分"), range: ref.strideFrequencyStepsPerMinute, value: reading(d.strideFrequency, "步/分", ref.strideFrequencyStepsPerMinute) },
        { title: "步速", reference: rangeText(speedRange, "m/s"), range: speedRange, value: reading(speed, "m/s", speedRange, 2) },
        { title: "对称性", reference: rangeText(sym, "%"), range: sym, value: reading(d.stepSymmetry, "%", sym, 1) },
        pair("步高", { ...feet(d.stepHeightByFoot, d.stepHeight) }, "cm", ref.stepHeightCm, sym, 1),
        pair("步幅", d.strideLengthByFoot, "cm", stride, sym, 1),
        pair("步幅身高比", ratio, "%", ratioRange, sym, 1, 1),
      ],
    },
    {
      title: "步态时间指标",
      metrics: [
        pair("步幅时间", { ...feet(d.strideTimeByFoot, d.strideTime) }, "s", ref.strideTimeSeconds, sym, 2),
        pair("支撑相", d.supportPhaseRatioByFoot, "%", ref.supportPhasePercent, sym, 1),
        pair("摆动相", d.swingPhaseRatioByFoot, "%", ref.swingPhasePercent, sym, 1),
        { title: "双脚支撑比", reference: rangeText(ref.doubleSupportPercent, "%"), range: ref.doubleSupportPercent, value: reading(doubleSupport, "%", ref.doubleSupportPercent, 1) },
      ],
    },
    {
      title: "步态力学指标",
      metrics: [
        pair("冲击力", d.impactForceNByFoot, "N", ref.impactForceN, sym),
        pair("推进力", d.propulsiveForceNByFoot, "N", ref.propulsiveForceN, sym, 2),
        pair("步进角", d.stepAngleByFoot, "°", ref.stepAngleDegrees, sym, 1),
        pair("内/外翻角度", d.rotationByFoot, "°", ref.rotationDegrees, sym, 1),
        pair("摆动幅度", d.swingByFoot, "cm", ref.swingCm, sym, 1),
      ],
    },
  ];

  const riskLevel = d.fallRiskType === 1 ? "normal" : d.fallRiskType === 2 ? "low" : d.fallRiskType === 3 ? "high" : "unknown";
  const riskText = d.fallRiskTypeDsp || (d.fallRiskType === 1 ? "低风险" : d.fallRiskType === 2 ? "中风险" : d.fallRiskType === 3 ? "高风险" : "未评估");

  const given = (d.gaitAnalysisResponse?.analysis ?? []).filter(Boolean);
  const pendingAi = !given.length && d.aiAnalysisStatus === "pending" && !opts.aiTimedOut;
  const analysis = given.length
    ? given
    : pendingAi
      ? ["AI 分析生成中…"]
      : d.aiAnalysisStatus === "pending"
        ? ["AI 分析生成超时"]
        : d.aiAnalysisStatus === "failed"
          ? ["AI 分析生成失败"]
          : d.aiAnalysisStatus === "empty"
            ? ["AI 没有返回分析结论"]
            : ["这次检测没有分析结论"];

  const attention = groups
    .flatMap((g) => g.metrics)
    .filter((x) => !x.plain)
    .map((x) => {
      const levels = [x.value, x.left, x.right].map((r) => r?.level);
      return { title: x.title, low: levels.includes("low"), high: levels.includes("high") };
    })
    .filter((x) => x.low || x.high);

  return {
    score: { value: num(score), raw: score, unit: "分", level: score == null ? "normal" : levelOf(score, { min: 80 }) },
    attention,
    risk: { text: riskText, level: riskLevel, score: d.fallRiskScore },
    analysis: parseAdvice(analysis),
    groups,
    patient: {
      name: d.realName || "-",
      gender: d.gender === 1 ? "男" : d.gender === 2 ? "女" : "-",
      age: d.age ? `${d.age} 岁` : "-",
      height: d.height ? `${num(d.height)} cm` : "-",
      weight: d.weight ? `${num(d.weight)} kg` : "-",
      reportNo: opts.reportNo || d.title || d.id,
      date: (d.createdAt ?? "").slice(0, 10) || "-",
    },
    pendingAi,
  };
}

// ---------- 传感器在线 ----------

export type SensorLink = "online" | "stale" | "offline";

/** 最后活动在这么久之内才算真的在线 */
const FRESH_MS = 30 * 60_000;

/**
 * 平台的 isOnline 对步态传感器不可靠（2026-11-01：显示在线的 62 台没有一台 24 小时内有活动，
 * 其中 23 台列表里连活动时间都没有）。所以显示在线的还要看最后活动时间，活动已经过期的单独标出来，不算在线。
 * 传感器经手机蓝牙上传，不接实时数据判断。
 */
export function sensorLink(d: Pick<GaitSensor, "isOnline" | "lastActivityTime">, now = Date.now()): SensorLink {
  if (!d.isOnline) return "offline";
  const t = d.lastActivityTime ? Date.parse(d.lastActivityTime.replace(" ", "T")) : NaN;
  return Number.isFinite(t) && now - t <= FRESH_MS ? "online" : "stale";
}

export const SENSOR_LINK_TEXT: Record<SensorLink, string> = { online: "在线", stale: "活动已过期", offline: "离线" };
