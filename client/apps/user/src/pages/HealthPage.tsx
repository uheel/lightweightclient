import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Skeleton, Table } from "antd";
import type { TableColumnsType } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useCare } from "../care/CareContext";
import { getHealthOverview, getOrgSleepReports, hm, minutesText, scoreLevel, SLEEP_SOURCES, type HealthOverview, type SleepReport } from "../care/health";

/** 健康：机构所有长者的昨夜睡眠一览（按每位长者的设备来源查询），点一行进入长者详情 */
export default function HealthPage() {
  const { s, members, attention, openElder } = useCare();
  const [data, setData] = useState<HealthOverview>();
  const [reports, setReports] = useState<SleepReport[]>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const today = dayjs().format("YYYY-MM-DD");

  const load = (force = false) => {
    if (!members.length) return;
    setLoading(true);
    setError(undefined);
    // 概况（在院人数、需关注人数）仍取驾驶舱；报告列表逐个长者按来源查
    getHealthOverview(s.orgId, force).then(setData, () => {});
    setProgress(0);
    getOrgSleepReports(s.orgId, members, today, force, setProgress)
      .then(setReports, (e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    setReports(undefined);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.orgId, members.length]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.memberId)), [members]);
  const list = reports ?? [];
  const scored = list.filter((r) => r.sleepScore !== undefined);
  const avg = scored.length ? Math.round(scored.reduce((n, r) => n + (r.sleepScore ?? 0), 0) / scored.length) : undefined;
  const lowScore = scored.filter((r) => (r.sleepScore ?? 100) < 60).length;
  const short = list.filter((r) => {
    const t = r.totalNightSleepMinutes ?? r.totalSleepMinutes;
    return t !== undefined && t > 0 && t < 300;
  }).length;

  const columns: TableColumnsType<SleepReport> = [
    {
      title: "长者",
      key: "name",
      width: 200,
      ellipsis: true,
      render: (_, r) => (
        <span>
          <b>{r.realName ?? "未命名长者"}</b>
          <div className="muted">{[r.roomName, r.bedName].filter(Boolean).join(" · ")}</div>
        </span>
      ),
    },
    {
      title: "来源",
      key: "source",
      width: 120,
      filters: Object.entries(SLEEP_SOURCES).map(([v, t]) => ({ text: `睡眠-${t}`, value: Number(v) })),
      onFilter: (v, r) => r.reportSource === v,
      render: (_, r) => (r.reportSource && SLEEP_SOURCES[r.reportSource] ? `睡眠-${SLEEP_SOURCES[r.reportSource]}` : "健康画像"),
    },
    {
      title: "睡眠评分",
      key: "score",
      width: 130,
      sorter: (a, b) => (a.sleepScore ?? 999) - (b.sleepScore ?? 999),
      render: (_, r) => {
        const lv = scoreLevel(r.sleepScore);
        return (
          <span>
            <b className="mono" style={{ color: lv.color, fontSize: 16 }}>
              {r.sleepScore ?? "—"}
            </b>{" "}
            <span className="muted">{lv.text}</span>
          </span>
        );
      },
    },
    {
      title: "睡眠时长",
      key: "total",
      width: 120,
      sorter: (a, b) => (a.totalNightSleepMinutes ?? a.totalSleepMinutes ?? 0) - (b.totalNightSleepMinutes ?? b.totalSleepMinutes ?? 0),
      render: (_, r) => {
        const t = r.totalNightSleepMinutes ?? r.totalSleepMinutes;
        return <span style={{ color: t !== undefined && t < 300 ? "#9A5B00" : undefined }}>{minutesText(t)}</span>;
      },
    },
    {
      title: "效率",
      key: "eff",
      width: 80,
      sorter: (a, b) => (a.sleepEfficiency ?? 0) - (b.sleepEfficiency ?? 0),
      render: (_, r) => <span className="mono">{r.sleepEfficiency !== undefined ? `${r.sleepEfficiency}%` : "—"}</span>,
    },
    {
      title: "夜间离床",
      key: "leave",
      width: 90,
      sorter: (a, b) => (a.leaveBedCount ?? 0) - (b.leaveBedCount ?? 0),
      render: (_, r) => (r.leaveBedCount !== undefined ? <span style={{ color: r.leaveBedCount >= 4 ? "#9A5B00" : undefined }}>{r.leaveBedCount} 次</span> : "—"),
    },
    {
      title: "入睡 / 醒来",
      key: "time",
      width: 120,
      render: (_, r) => (
        <span className="mono">
          {hm(r.fallAsleepTime)} – {hm(r.wakeUpTime)}
        </span>
      ),
    },
    {
      title: "心率 / 呼吸",
      key: "vitals",
      width: 110,
      render: (_, r) => (
        <span className="mono">
          {r.avgHeartRate ?? "—"} / {r.avgBreathingRate ?? "—"}
        </span>
      ),
    },
    {
      title: "呼吸紊乱指数",
      key: "ahi",
      width: 110,
      sorter: (a, b) => (a.ahi ?? 0) - (b.ahi ?? 0),
      render: (_, r) => <span style={{ color: (r.ahi ?? 0) >= 15 ? "#B4232A" : undefined }}>{r.ahi ?? "—"}</span>,
    },
  ];

  return (
    <div className="page">
      <div className="care-head">
        <div>
          <h1>健康</h1>
          <p>
            {s.orgName} · {dayjs(today).subtract(1, "day").format("M 月 D 日")}晚的睡眠
          </p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => load(true)} loading={loading}>
          刷新
        </Button>
      </div>

      {error && <Alert type="error" showIcon message={`加载健康数据失败：${error}`} />}
      {!reports && !error ? (
        <div className="card" style={{ padding: 20 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            正在查询每位长者的睡眠报告 {progress} / {members.length}（第一次打开时平台需要生成报告，可能稍慢）
          </p>
          <Skeleton active />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="card stat">
              <small>在院长者</small>
              <b className="mono">{data?.summary?.inHospitalElderCount ?? members.length}</b>
            </div>
            <div className="card stat">
              <small>昨夜有睡眠报告</small>
              <b className="mono">{list.length}</b>
            </div>
            <div className="card stat">
              <small>平均睡眠评分</small>
              <b className="mono" style={{ color: scoreLevel(avg).color }}>
                {avg ?? "—"}
              </b>
            </div>
            <div className="card stat warn">
              <small>评分低于 60</small>
              <b className="mono">{lowScore}</b>
            </div>
            <div className="card stat warn">
              <small>睡眠不足 5 小时</small>
              <b className="mono">{short}</b>
            </div>
            <div className="card stat warn">
              <small>今日需关注</small>
              <b className="mono">{data?.attentionTotal ?? attention.total}</b>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <Table<SleepReport>
              rowKey="memberId"
              columns={columns}
              dataSource={list}
              loading={loading}
              tableLayout="fixed"
              scroll={{ x: 1240 }}
              locale={{ emptyText: "昨夜没有睡眠报告" }}
              pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 位` }}
              onRow={(r) =>
                memberIds.has(r.memberId) ? { onClick: () => openElder(r.memberId), style: { cursor: "pointer" } } : {}
              }
            />
          </div>
          <p className="muted">
            按每位长者绑定的设备查询对应来源的睡眠报告（AIO / Ultra / UltraFall / Ultra Plus）；没有报告的长者不在列表中。来源为"健康画像"的只有睡眠分期，没有评分。
          </p>
        </>
      )}
    </div>
  );
}
