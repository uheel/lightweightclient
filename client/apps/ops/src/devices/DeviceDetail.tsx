import { useEffect, useMemo, useState } from "react";
import { App, Button, Tabs, Tooltip } from "antd";
import { DeleteOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { deviceLink, POSTURE, type LiveData } from "@radar/core";
import { getDeviceReport, getRoomInfo, INSTALL_DIR, INSTALL_TYPE, isSlim, WORKING_TYPE, type DeviceReport, type Radar, type RoomInfo } from "../api/device";
import { lastSeen } from "../pages/DevicesPage";
import { evaluate, GRADE_TEXT } from "./angle";
import AlarmTab from "./AlarmTab";
import AngleTab from "./AngleTab";
import ReplayView from "./replay/ReplayView";
import LogTable from "./LogTable";
import PropertyTab from "./PropertyTab";
import LocationDialog from "./LocationDialog";
import DeleteDeviceDialog from "./DeleteDeviceDialog";
import NameEdit from "./NameEdit";
import { radarInRoom, type QlConfig } from "../rooms/qinglan";
import AreaSelect from "../rooms/AreaSelect";
import { areaText, type InstallArea } from "../rooms/installArea";
import { setSlotArea } from "../rooms/radarSlot";

export default function DeviceDetail({
  d,
  live,
  typeName,
  listHidden,
  onToggleList,
  onMoved,
  onDeleted,
}: {
  d: Radar;
  /** 这台设备的实时推送（由设备列表统一订阅） */
  live?: LiveData;
  typeName?: string;
  listHidden: boolean;
  onToggleList: () => void;
  /** 改了安装位置，设备列表要重新取 */
  onMoved?: () => void;
  /** 设备删掉了，列表要去掉它 */
  onDeleted?: () => void;
}) {
  const { message } = App.useApp();
  const [room, setRoom] = useState<RoomInfo>();
  const [savingArea, setSavingArea] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rep, setRep] = useState<DeviceReport>({});
  const [hbLoading, setHbLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  // 每 30 秒更新一次"当前时间"，用来判断 10 分钟内有没有收到设备数据
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setRoom(undefined);
    if (d.roomId) getRoomInfo(d.roomId).then(setRoom, () => {});
    // 最近一次心跳：先查最近 2 小时；心跳约每分钟一次，之后每分钟查上一条之后的，保持"最近心跳 / 在线"准确。
    // 上一次返回后才排下一次，平台慢的时候不会越堆越多
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let lastT: number | undefined;
    setRep({});
    const load = async () => {
      try {
        const r = await getDeviceReport(d.sn, d.deviceType, lastT);
        if (alive) {
          if (r.lastReportAt) lastT = r.lastReportAt;
          setRep((cur) => ({
            lastReportAt: Math.max(cur.lastReportAt ?? 0, r.lastReportAt ?? 0) || undefined,
            rssi: r.rssi ?? cur.rssi,
            angle: cur.angle && r.angle && cur.angle.t >= r.angle.t ? cur.angle : (r.angle ?? cur.angle),
          }));
        }
      } catch {
        /* 下次再试 */
      }
      if (!alive) return;
      setHbLoading(false);
      timer = setTimeout(load, 60_000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [d.sn, d.roomId, d.deviceType]);

  const cfg = room?.configs.get(d.sn);
  /** 布置里的这台雷达，以及同一个房间里的其他雷达（卧室、卫生间各一台这种） */
  const slot = room?.radars.find((x) => x.sn === d.sn);
  const peers = room?.radars.filter((x) => x.sn !== d.sn) ?? [];

  async function changeArea(a: InstallArea | null) {
    if (!d.roomId) return;
    setSavingArea(true);
    try {
      if (!(await setSlotArea(d.roomId, d.sn, a))) throw new Error("房间布置里没有这台雷达");
      setRoom(await getRoomInfo(d.roomId));
      message.success(a ? `已设为装在${areaText(a)}` : "已清除安装区域");
    } catch (e) {
      message.error(`保存安装区域失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingArea(false);
    }
  }
  // 区域画布按房间平面图的方向画，并画出房间的墙
  const plan = useMemo(
    () => (cfg ? { facing: cfg.installDirection, room: room?.size ? { ...room.size, radar: radarInRoom(cfg as QlConfig) } : undefined } : undefined),
    [cfg, room],
  );
  const installType = cfg?.installType === 0 || cfg?.installType === 1 ? cfg.installType : undefined;
  // 在线状态和最近活动以设备数据（实时推送、心跳）为准，没收到时才用平台记录（规则见 core 的 deviceLink，与用户端一致）
  const hb = rep.angle;
  const link = deviceLink({ live, lastReportAt: rep.lastReportAt, platformOnline: d.isOnline, now: Math.max(now, live?.updatedAt ?? 0) });
  const statusCls = d.isDisabled ? "disabled" : link.online ? "online" : "offline";
  const statusText = (d.isDisabled ? "已停用" : link.online ? "在线" : "离线") + (link.source === "platform" && !d.isDisabled ? "（平台记录）" : "");
  const ev = hb ? evaluate(hb, installType ?? 1) : undefined;

  const rssi = rep.rssi ?? d.rssi;
  const slim = isSlim(d.deviceType);
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
          <small>检测到人数</small>
          <b>{live?.targets ?? (live?.presence === 0 ? 0 : "—")}</b>
        </div>
        <div>
          <small>信号强度</small>
          <b>{rssi !== undefined && rssi !== null ? `${rssi} dBm` : "—"}</b>
        </div>
        <div>
          <small>最近心跳</small>
          <b>{rep.lastReportAt ? dayjs(rep.lastReportAt).fromNow() : hbLoading ? "…" : "2 小时内无"}</b>
        </div>
      </div>
      <div className="ops-grid">
        <div className="ops-card">
          <h2>基本信息</h2>
          <dl className="kv">
            <dt>所属机构</dt>
            <dd>{d.orgName}</dd>
            <dt>房间</dt>
            <dd>
              {room?.place || d.roomName || "未绑定房间"}
              <Button type="link" size="small" onClick={() => setMoving(true)} style={{ height: "auto", padding: "0 6px" }}>
                {d.roomId ? "更改" : "设置"}
              </Button>
            </dd>
            {d.roomId && (
              <>
                <dt>安装区域</dt>
                <dd className="area-dd">
                  {slot ? (
                    <AreaSelect size="small" value={slot.area} loading={savingArea} disabled={savingArea} placeholder="未设置" onChange={changeArea} />
                  ) : (
                    <span className="muted">{room ? "房间布置里没有这台雷达" : "…"}</span>
                  )}
                  {peers.length > 0 && (
                    <span className="muted small">
                      同房间还有 {peers.map((x) => `${x.deviceName || x.sn.slice(-4)}${x.area ? `（${areaText(x.area)}）` : ""}`).join("、")}
                    </span>
                  )}
                </dd>
              </>
            )}
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
                绿色区间为允许偏差，
                {slim ? `角度来自 ${dayjs(hb!.t).format("YYYY-MM-DD HH:mm:ss")} 的上报（这类设备只在姿态变化时上报角度）。` : `角度来自 ${dayjs(hb!.t).format("HH:mm:ss")} 的心跳。`}
              </p>
              <Button size="small" onClick={() => setTab("angle")}>
                查看角度曲线
              </Button>
            </>
          ) : (
            <p className="muted small">
              {hbLoading ? "正在读取心跳…" : slim ? "最近半年没有上报过安装角度。这类设备只在姿态变化时上报，装好后动一下设备就会报。" : "最近 2 小时没有带安装角度的心跳。设备离线或固件不上报角度时会这样。"}
            </p>
          )}
        </div>
      </div>
      <div className="dev-danger">
        <Button danger icon={<DeleteOutlined />} onClick={() => setDeleting(true)}>
          删除设备
        </Button>
        <span className="muted small">房间、床位、长者上的绑定会一起解除</span>
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
          <NameEdit d={d} onRenamed={onMoved} />
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
          { key: "angle", label: "安装角度", children: <AngleTab sn={d.sn} deviceType={d.deviceType} installType={installType} online={link.online} /> },
          { key: "replay", label: "时间回溯", children: <ReplayView roomId={d.roomId} sn={d.sn} /> },
          { key: "props", label: "设备属性", children: <PropertyTab sn={d.sn} online={link.online} plan={plan} roomId={d.roomId} layout={cfg as QlConfig | undefined} onLayoutSynced={() => d.roomId && getRoomInfo(d.roomId).then(setRoom, () => {})} /> },
          { key: "alarm", label: "告警配置", children: <AlarmTab d={d} online={link.online} /> },
          { key: "log", label: "通信日志", children: <LogTable sn={d.sn} /> },
        ]}
      />
      <LocationDialog
        d={d}
        open={moving}
        onClose={() => setMoving(false)}
        onMoved={() => {
          setMoving(false);
          onMoved?.();
        }}
      />
      <DeleteDeviceDialog
        d={d}
        open={deleting}
        online={link.online && !d.isDisabled}
        place={room?.place}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          setDeleting(false);
          onDeleted?.();
        }}
      />
    </div>
  );
}
