import { useEffect, useState } from "react";
import { Button, Tabs } from "antd";
import { FileSearchOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { deviceChannels, parseDeviceData, POSTURE, realtime, subscribeChannels, type DeviceDataMessage, type LiveData } from "@radar/core";
import { getHeartbeats, getRoomInfo, INSTALL_DIR, INSTALL_TYPE, WORKING_TYPE, type Heartbeat, type Radar, type RoomInfo } from "../api/device";
import { lastSeen } from "../pages/DevicesPage";
import { evaluate, GRADE_TEXT } from "./angle";
import AngleTab from "./AngleTab";
import ReplayView from "./replay/ReplayView";
import LogTable from "./LogTable";

const FMT = "YYYY-MM-DD HH:mm:ss";

/** 订阅一台设备的实时推送，合并成最新状态 */
function useLive(sn: string) {
  const [live, setLive] = useState<LiveData>();
  useEffect(() => {
    const off = realtime.on("DeviceData", (payload) => {
      const m = payload as DeviceDataMessage;
      if (m?.sn !== sn) return;
      const patch = parseDeviceData(m);
      if (patch) setLive((cur) => ({ ...cur, ...patch, updatedAt: patch.updatedAt ?? Date.now() }));
    });
    const unsub = subscribeChannels(deviceChannels(sn));
    return () => {
      off();
      unsub();
    };
  }, [sn]);
  return live;
}

export default function DeviceDetail({
  d,
  typeName,
  onOpenLogs,
  listHidden,
  onToggleList,
}: {
  d: Radar;
  typeName?: string;
  onOpenLogs: (sn: string) => void;
  listHidden: boolean;
  onToggleList: () => void;
}) {
  const [room, setRoom] = useState<RoomInfo>();
  const [hb, setHb] = useState<Heartbeat>();
  const [hbLoading, setHbLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const live = useLive(d.sn);

  useEffect(() => {
    if (d.roomId) getRoomInfo(d.roomId).then(setRoom, () => {});
    // 最近一次心跳：查最近 2 小时
    getHeartbeats(d.sn, [dayjs().subtract(2, "hour").format(FMT), dayjs().format(FMT)], 200)
      .then((list) => setHb(list[list.length - 1]), () => {})
      .finally(() => setHbLoading(false));
  }, [d.sn, d.roomId]);

  const cfg = room?.configs.get(d.sn);
  const installType = cfg?.installType === 0 || cfg?.installType === 1 ? cfg.installType : undefined;
  const statusCls = d.isDisabled ? "disabled" : d.isOnline ? "online" : "offline";
  const statusText = d.isDisabled ? "已停用" : d.isOnline ? "在线" : "离线";
  const ev = hb ? evaluate(hb, installType ?? 1) : undefined;

  const rssi = hb?.rssi ?? d.rssi;
  const install = [
    installType !== undefined ? INSTALL_TYPE[installType] : undefined,
    cfg?.installDirection ? INSTALL_DIR[cfg.installDirection] : undefined,
    cfg?.installHeight ? `高度 ${cfg.installHeight} cm` : undefined,
  ].filter(Boolean);

  const overview = (
    <div className="detail-body">
      <div className="kpis">
        <div>
          <small>当前姿态</small>
          <b>{live?.posture !== undefined ? (POSTURE[live.posture] ?? live.posture) : live?.presence === 0 ? "无人" : "—"}</b>
        </div>
        <div>
          <small>房间人数</small>
          <b>{live?.targets ?? (live?.presence === 0 ? 0 : "—")}</b>
        </div>
        <div>
          <small>信号强度</small>
          <b>{rssi !== undefined && rssi !== null ? `${rssi} dBm` : "—"}</b>
        </div>
        <div>
          <small>最近心跳</small>
          <b>{hb ? dayjs(hb.t).fromNow() : hbLoading ? "…" : "2 小时内无"}</b>
        </div>
      </div>
      <div className="ops-grid">
        <div className="ops-card">
          <h2>基本信息</h2>
          <dl className="kv">
            <dt>所属机构</dt>
            <dd>{d.orgName}</dd>
            <dt>房间</dt>
            <dd>{room?.place || d.roomName || "未绑定房间"}</dd>
            <dt>长者</dt>
            <dd>{d.realName || (d.memberCount ? `${d.memberCount} 人` : "—")}</dd>
            <dt>设备类型</dt>
            <dd>{typeName ?? d.deviceType ?? "—"}</dd>
            <dt>固件版本</dt>
            <dd className="mono">{hb?.fw ?? d.firmwareVersion ?? "—"}</dd>
            <dt>安装</dt>
            <dd>{install.length ? install.join(" · ") : d.roomId ? "房间布局里未配置" : "—"}</dd>
            <dt>工作模式</dt>
            <dd>{cfg?.workingType !== undefined ? (WORKING_TYPE[cfg.workingType] ?? cfg.workingType) : "—"}</dd>
            <dt>IP</dt>
            <dd className="mono">{hb?.ip ?? "—"}</dd>
            <dt>最近活动</dt>
            <dd>{d.lastActivityTime ? `${d.lastActivityTime}（${lastSeen(d.lastActivityTime)}）` : "—"}</dd>
          </dl>
        </div>
        <div className="ops-card">
          <h2>
            安装角度
            {ev && <span className={`grade ${ev.grade}`}>{GRADE_TEXT[ev.grade]}</span>}
          </h2>
          {ev ? (
            <>
              <div className="axes">
                {ev.axes.map((a) => {
                  const pos = Math.max(4, Math.min(96, 50 + (a.dev / ev.tol) * 15));
                  return (
                    <div key={a.k} className="axis">
                      <span className="mono">{a.k}</span>
                      <span className="axis-track">
                        <span className="axis-band" />
                        <span className={`axis-mark ${a.grade}`} style={{ left: `${pos}%` }} />
                      </span>
                      <span className="mono axis-val">
                        {a.value.toFixed(1)}° <em>/ {a.std}°</em>
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="muted small">
                {installType === undefined ? "房间布局里没有安装方式，按侧装标准判断。" : `${ev.name}标准，允许偏差 ±${ev.tol}°。`}
                绿色区间为允许偏差，角度来自 {dayjs(hb!.t).format("HH:mm:ss")} 的心跳。
              </p>
              <Button size="small" onClick={() => setTab("angle")}>
                查看角度曲线
              </Button>
            </>
          ) : (
            <p className="muted small">{hbLoading ? "正在读取心跳…" : "最近 2 小时没有带安装角度的心跳。设备离线或固件不上报角度时会这样。"}</p>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="detail-title">
          <h1>{d.deviceName || d.sn}</h1>
          <span className={`status-tag ${statusCls}`}>{statusText}</span>
        </div>
        <div className="detail-sub">
          <span>
            SN <span className="mono">{d.sn}</span>
          </span>
          <span>{d.roomName || "未绑定房间"}</span>
          <span>{[typeName, install[0], cfg?.workingType !== undefined ? WORKING_TYPE[cfg.workingType] : undefined].filter(Boolean).join(" · ") || "雷达"}</span>
        </div>
        <div className="detail-actions">
          <Button icon={listHidden ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={onToggleList}>
            {listHidden ? "显示设备列表" : "收起设备列表"}
          </Button>
          <Button icon={<FileSearchOutlined />} onClick={() => onOpenLogs(d.sn)}>
            在日志中查询
          </Button>
        </div>
      </div>
      <Tabs
        className="detail-tabs"
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden
        items={[
          { key: "overview", label: "概览", children: overview },
          { key: "angle", label: "安装角度", children: <AngleTab sn={d.sn} installType={installType} online={d.isOnline} /> },
          { key: "replay", label: "姿态回放", children: <ReplayView roomId={d.roomId} sn={d.sn} /> },
          { key: "log", label: "通信日志", children: <LogTable sn={d.sn} compact /> },
        ]}
      />
    </div>
  );
}
