import { useEffect, useState } from "react";
import { Button, Tabs, Tooltip } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { deviceLink, POSTURE, type LiveData } from "@radar/core";
import { getHeartbeats, getRoomInfo, INSTALL_DIR, INSTALL_TYPE, WORKING_TYPE, type Heartbeat, type Radar, type RoomInfo } from "../api/device";
import { lastSeen } from "../pages/DevicesPage";
import { evaluate, GRADE_TEXT } from "./angle";
import AlarmTab from "./AlarmTab";
import AngleTab from "./AngleTab";
import ReplayView from "./replay/ReplayView";
import LogTable from "./LogTable";
import PropertyTab from "./PropertyTab";

const FMT = "YYYY-MM-DD HH:mm:ss";

export default function DeviceDetail({
  d,
  live,
  typeName,
  listHidden,
  onToggleList,
}: {
  d: Radar;
  /** 这台设备的实时推送（由设备列表统一订阅） */
  live?: LiveData;
  typeName?: string;
  listHidden: boolean;
  onToggleList: () => void;
}) {
  const [room, setRoom] = useState<RoomInfo>();
  const [hb, setHb] = useState<Heartbeat>();
  const [hbLoading, setHbLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  // 每 30 秒更新一次"当前时间"，用来判断 10 分钟内有没有收到设备数据
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (d.roomId) getRoomInfo(d.roomId).then(setRoom, () => {});
    // 最近一次心跳：查最近 2 小时
    getHeartbeats(d.sn, [dayjs().subtract(2, "hour").format(FMT), dayjs().format(FMT)], 200)
      .then((list) => setHb(list[list.length - 1]), () => {})
      .finally(() => setHbLoading(false));
    // 心跳约每分钟一次：每分钟取一次最新的，保持"最近心跳 / 在线"准确
    const t = setInterval(() => {
      getHeartbeats(d.sn, undefined, 8).then(
        (list) => list.length && setHb((cur) => (cur && cur.t >= list[list.length - 1].t ? cur : list[list.length - 1])),
        () => {},
      );
    }, 60_000);
    return () => clearInterval(t);
  }, [d.sn, d.roomId]);

  const cfg = room?.configs.get(d.sn);
  const installType = cfg?.installType === 0 || cfg?.installType === 1 ? cfg.installType : undefined;
  // 在线状态和最近活动以设备数据（实时推送、心跳）为准，没收到时才用平台记录（规则见 core 的 deviceLink，与用户端一致）
  const link = deviceLink({ live, lastReportAt: hb?.t, platformOnline: d.isOnline, now: Math.max(now, live?.updatedAt ?? 0) });
  const statusCls = d.isDisabled ? "disabled" : link.online ? "online" : "offline";
  const statusText = (d.isDisabled ? "已停用" : link.online ? "在线" : "离线") + (link.source === "platform" && !d.isDisabled ? "（平台记录）" : "");
  const ev = hb ? evaluate(hb, installType ?? 1) : undefined;

  const rssi = hb?.rssi ?? d.rssi;
  const install = [
    installType !== undefined ? INSTALL_TYPE[installType] : undefined,
    cfg?.installDirection ? INSTALL_DIR[cfg.installDirection] : undefined,
    cfg?.installHeight ? `高度 ${cfg.installHeight} m` : undefined,
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
            <dd>
              {link.at ? (
                `${dayjs(link.at).format("YYYY-MM-DD HH:mm:ss")}（${lastSeen(link.at)}）`
              ) : d.lastActivityTime ? (
                <span title="还没收到这台设备的数据，显示的是平台记录，可能有延迟">
                  {d.lastActivityTime}（平台记录）
                </span>
              ) : (
                "—"
              )}
            </dd>
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
          <Tooltip title={listHidden ? "显示设备列表" : "收起设备列表"}>
            <Button
              type="text"
              size="small"
              aria-label={listHidden ? "显示设备列表" : "收起设备列表"}
              icon={listHidden ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={onToggleList}
            />
          </Tooltip>
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
      </div>
      <Tabs
        className="detail-tabs"
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden
        items={[
          { key: "overview", label: "概览", children: overview },
          { key: "angle", label: "安装角度", children: <AngleTab sn={d.sn} installType={installType} online={link.online} /> },
          { key: "replay", label: "姿态回放", children: <ReplayView roomId={d.roomId} sn={d.sn} /> },
          { key: "props", label: "设备属性", children: <PropertyTab sn={d.sn} online={link.online} /> },
          { key: "alarm", label: "告警配置", children: <AlarmTab d={d} online={link.online} /> },
          { key: "log", label: "通信日志", children: <LogTable sn={d.sn} /> },
        ]}
      />
    </div>
  );
}
