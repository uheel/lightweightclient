import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Skeleton } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { LiveData } from "@radar/core";
import type { CareAlert, Member } from "../care/api";
import { attentionReasons, useAttentionRules } from "../care/attention";
import NightTimeline from "../care/NightTimeline";
import { careState, sinceText, TONE_STYLE } from "../care/state";
import {
  getMemberSleepReport,
  SLEEP_SOURCES,
  getMemberInfo,
  getRecentAlertsOf,
  minutesText,
  scoreLevel,
  STAGES,
  STAGE_ORDER,
  derivedTimes,
  getPostureTimeline,
  getVitalMinutes,
  stageCodesOf,
  stageMinutesOf,
  type MemberInfo,
  type SleepReport,
  type PostureSeg,
  type VitalPoint,
} from "../care/health";

/** 长者详情（界面稿"长者详情 · 健康数据"）：现在的状态、昨夜睡眠、夜间心率呼吸、近 7 天、近期告警 */
export default function ElderDetail({
  orgId,
  member,
  live,
  alert,
  now,
  onBack,
  onProcess,
}: {
  orgId: string;
  member: Member;
  live?: LiveData;
  alert?: CareAlert;
  now: number;
  onBack: () => void;
  onProcess: (a: CareAlert) => void;
}) {
  const [info, setInfo] = useState<MemberInfo>();
  const [report, setReport] = useState<SleepReport | null>();
  const [week, setWeek] = useState<{ date: string; minutes?: number }[]>();
  const [history, setHistory] = useState<CareAlert[]>();
  const [vitals, setVitals] = useState<VitalPoint[]>();
  const [postures, setPostures] = useState<PostureSeg[]>();

  useEffect(() => {
    let cancelled = false;
    setReport(undefined);
    setWeek(undefined);
    setHistory(undefined);
    setVitals(undefined);
    setPostures(undefined);
    getMemberInfo(member.memberId).then((x) => !cancelled && setInfo(x), () => {});

    // 昨夜睡眠：按长者绑定设备对应的报告来源（AIO / Ultra / UltraFall …）查询，没有再用健康画像兜底（没有评分）。
    // 不使用驾驶舱数据：驾驶舱只统计 AIO 来源，而且平台的汇总页面有不少问题
    const today = dayjs().format("YYYY-MM-DD");
    getMemberSleepReport(member, today).then(
      (r) => !cancelled && setReport(r ?? null),
      () => !cancelled && setReport(null),
    );

    // 近 7 天睡眠时长（同样按来源逐天查询）
    const days = Array.from({ length: 7 }, (_, i) => dayjs().subtract(6 - i, "day").format("YYYY-MM-DD"));
    Promise.all(days.map((d) => getMemberSleepReport(member, d).catch(() => undefined))).then(
      (rs) => !cancelled && setWeek(days.map((d, i) => ({ date: d, minutes: rs[i]?.totalNightSleepMinutes ?? rs[i]?.totalSleepMinutes }))),
    );

    getRecentAlertsOf(member.memberId).then((x) => !cancelled && setHistory(x), () => !cancelled && setHistory([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, member.memberId]);

  // 报告加载后，按这一晚的时间范围取每分钟心率呼吸（比报告里每 10 分钟一个点更细）
  useEffect(() => {
    if (!report) return;
    let cancelled = false;
    const segs = report.sleepDetails ?? [];
    const p = (t?: string) => (t ? Date.parse(t.replace(" ", "T")) : NaN);
    const night = dayjs(report.reportDate);
    const startC = [segs[0]?.startTime, p(report.bedTime)].filter((x): x is number => !!x && !Number.isNaN(x));
    const endC = [segs[segs.length - 1]?.endTime, p(report.getUpTime)].filter((x): x is number => !!x && !Number.isNaN(x));
    const start = startC.length ? Math.min(...startC) : night.subtract(1, "day").hour(20).valueOf();
    const end = endC.length ? Math.max(...endC) : night.hour(9).valueOf();
    // 设备每分钟上报的心率呼吸：曲线和"在床"判断都以它为准（报告附带的序列是平台加工的，偶有空缺）
    getVitalMinutes(member.memberId, start, end).then(
      (v) => !cancelled && setVitals(v),
      () => !cancelled && setVitals([]),
    );
    // 同一时段的雷达位置（所有跟踪目标），用来和睡眠报告对照
    const sns = (member.devices ?? []).map((d) => d.sn).filter(Boolean);
    if (sns.length)
      getPostureTimeline(sns, start, end).then(
        (x) => !cancelled && setPostures(x),
        () => !cancelled && setPostures([]),
      );
    return () => {
      cancelled = true;
    };
  }, [report, member.memberId, member.devices]);

  const st = careState(member, live, alert, now);
  const tone = TONE_STYLE[st.tone];
  const showVitals = live && (live.heartRate || live.respiratoryRate) && st.tone !== "unknown";
  const gender = info?.gender === 1 ? "男" : info?.gender === 2 ? "女" : "";

  return (
    <div className="page detail">
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} className="detail-back">
        返回
      </Button>

      {alert && (
        <div className="detail-alert">
          <span>
            <b>{alert.alertTypeName}</b> · {sinceText(alert.createdAt, now)}，尚未处理
          </span>
          <Button type="primary" danger onClick={() => onProcess(alert)}>
            处理
          </Button>
        </div>
      )}

      <section className="card detail-head">
        <span className="elder-avatar big" style={{ background: tone.bg, color: tone.color }}>
          {member.realName.charAt(0)}
        </span>
        <div className="detail-who">
          <h1>{member.realName}</h1>
          <span>{[member.age ?? info?.age ? `${member.age ?? info?.age} 岁` : "", gender, member.bedName].filter(Boolean).join(" · ")}</span>
          {info?.checkedInAt && <small>{info.checkedInAt.slice(0, 10)} 入住</small>}
        </div>
        <div className="detail-now">
          <div>
            <small>现在</small>
            <b style={{ color: tone.color }}>{st.text}</b>
            <small>{st.detail ?? " "}</small>
          </div>
          {showVitals && (
            <>
              <div>
                <small>心率</small>
                <b>
                  <span className="mono">{live?.heartRate ?? "—"}</span>
                  <i> 次/分</i>
                </b>
              </div>
              <div>
                <small>呼吸</small>
                <b>
                  <span className="mono">{live?.respiratoryRate ?? "—"}</span>
                  <i> 次/分</i>
                </b>
              </div>
            </>
          )}
        </div>
      </section>

      <div className="detail-grid">
        <section className="card detail-sleep">
          <h2>
            昨夜睡眠{report?.reportDate ? ` · ${dayjs(report.reportDate).subtract(1, "day").format("M 月 D 日")}晚` : ""}
            {report?.reportSource && SLEEP_SOURCES[report.reportSource] ? <span className="source-tag">睡眠-{SLEEP_SOURCES[report.reportSource]}</span> : null}
          </h2>
          {report === undefined ? (
            <Skeleton active />
          ) : report === null ? (
            <Empty description="昨夜没有睡眠数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <SleepSummary r={report} />
          )}
        </section>

        <section className="card detail-attention">
          <h2>需要关注</h2>
          <AttentionList report={report ?? undefined} alert={alert} />
        </section>

        <section className="card detail-span3">
          <h2>夜间时间线</h2>
          {report === undefined ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : report && (report.sleepDetails?.length || report.heartRateTrend?.some((v) => v > 0) || report.breathingTrend?.some((v) => v > 0) || vitals?.length) ? (
            <NightTimeline r={report} codes={stageCodesOf(report)} vitals={vitals} postures={postures} />
          ) : (
            <Empty description="没有夜间睡眠与体征数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </section>

        <section className="card">
          <h2>近 7 天睡眠时长</h2>
          {!week ? <Skeleton active paragraph={{ rows: 3 }} /> : <WeekBars week={week} />}
        </section>

        <section className="card">
          <h2>近期告警</h2>
          {!history ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : history.length === 0 ? (
            <p className="muted">最近没有告警</p>
          ) : (
            <ul className="history">
              {history.map((a) => (
                <li key={a.id}>
                  <span className="mono">{a.createdAt.slice(5, 16)}</span>
                  <b style={{ color: a.alertStatus === 1 ? "#B4232A" : undefined }}>{a.alertTypeName}</b>
                  <span className="muted">{a.alertStatus === 1 ? "未处理" : ((a as { alertProcessTypeName?: string }).alertProcessTypeName ?? "已处理")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function SleepSummary({ r }: { r: SleepReport }) {
  const level = scoreLevel(r.sleepScore);
  const total = r.totalNightSleepMinutes ?? r.totalSleepMinutes;
  // 睡眠分段有两套编码，先判断；各阶段时长有分段明细时按明细统计（汇总字段有时和明细对不上）
  const codes = useMemo(() => stageCodesOf(r), [r]);
  const minutes = stageMinutesOf(r, codes);
  const derived = derivedTimes(r, codes);
  const stageTotal = STAGE_ORDER.reduce((n, k) => n + (minutes[k] ?? 0), 0) || 1;
  const pct = r.sleepScore !== undefined ? Math.max(0, Math.min(100, r.sleepScore)) : 0;

  return (
    <div className="sleep">
      <div className="sleep-top">
        <div className="score-ring" aria-label={`睡眠评分 ${r.sleepScore ?? "暂无"}`}>
          <svg width="108" height="108" viewBox="0 0 108 108" aria-hidden="true">
            <circle cx="54" cy="54" r="46" fill="none" stroke="#F1F2F7" strokeWidth="10" />
            <circle
              cx="54"
              cy="54"
              r="46"
              fill="none"
              stroke={level.color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 289} 289`}
              transform="rotate(-90 54 54)"
            />
          </svg>
          <div>
            <b className="mono">{r.sleepScore ?? "—"}</b>
            <small style={{ color: level.color }}>{level.text}</small>
          </div>
        </div>
        <dl className="sleep-stats">
          <div>
            <dt>睡眠时长</dt>
            <dd>{minutesText(total)}</dd>
          </div>
          <div>
            <dt>睡眠效率</dt>
            <dd className="mono">{r.sleepEfficiency !== undefined ? `${r.sleepEfficiency}%` : "—"}</dd>
          </div>
          <div>
            <dt>夜间离床</dt>
            <dd>{derived.leaveBedCount !== undefined ? `${derived.leaveBedCount} 次` : "—"}</dd>
          </div>
          <div>
            <dt>入睡 / 醒来</dt>
            <dd className="mono">
              {derived.fallAsleep} – {derived.wakeUp}
            </dd>
          </div>
        </dl>
      </div>

      <div className="stage-legend">
        {STAGE_ORDER.map((k) => (
          <span key={k}>
            <i style={{ background: STAGES[k].color }} />
            {STAGES[k].label} {minutesText(minutes[k])}
            <em> {Math.round(((minutes[k] ?? 0) / stageTotal) * 100)}%</em>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 需要关注：与总览、长者列表同一套规则（attention.ts），这里用本页加载的报告重新算一遍，保证和页面上显示的报告一致 */
function AttentionList({ report, alert }: { report?: SleepReport; alert?: CareAlert }) {
  const rules = useAttentionRules();
  const { reasons } = attentionReasons(report, alert ? [alert] : [], rules);
  if (!reasons.length) return <p className="muted">目前没有需要特别关注的地方</p>;
  return (
    <ul className="attention-reasons">
      {reasons.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

function WeekBars({ week }: { week: { date: string; minutes?: number }[] }) {
  const max = Math.max(480, ...week.map((d) => d.minutes ?? 0));
  return (
    <div className="week">
      {week.map((d) => (
        <div key={d.date} className="week-col">
          <small className="mono">{d.minutes ? (d.minutes / 60).toFixed(1) : "—"}</small>
          <span style={{ height: `${((d.minutes ?? 0) / max) * 96}px`, background: (d.minutes ?? 0) < 300 ? "#F5C26B" : "#8EA0FF" }} />
          <small>{dayjs(d.date).format("ddd")}</small>
        </div>
      ))}
    </div>
  );
}
