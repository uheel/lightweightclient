import { useState } from "react";
import { Button, Tabs } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { lastSeen } from "../../pages/DevicesPage";
import DetailHead from "../DetailHead";
import LogTable from "../LogTable";
import type { DevRow } from "../category";
import MasterRooms from "./MasterRooms";
import CallRecords from "./CallRecords";
import MasterSipActions from "./MasterSip";
import DeleteOtherDialog from "../DeleteOtherDialog";

const fmt = (t?: string) => (t ? `${dayjs(t).format("YYYY-MM-DD HH:mm:ss")}（${lastSeen(t)}）` : "—");

/** 管理主机详情：SIP 状态、覆盖的房间和通讯录、通话记录、通信日志 */
export default function MasterDetail({
  d,
  radars,
  typeName,
  listHidden,
  onToggleList,
  onChanged,
  onDeleted,
}: {
  d: DevRow;
  /** 机构里的雷达，用来显示每个房间有几台、哪些没进通讯录 */
  radars: DevRow[];
  typeName?: string;
  listHidden: boolean;
  onToggleList: () => void;
  /** 改名、改覆盖房间后，设备列表要重新取 */
  onChanged?: () => void;
  /** 主机删掉了，列表要去掉它 */
  onDeleted?: () => void;
}) {
  const m = d.master;
  const [tab, setTab] = useState("overview");
  const [deleting, setDeleting] = useState(false);
  const sipText = !m?.sipEnable ? "未启用" : m.isSipRegister ? "已注册" : "未注册";

  const overview = (
    <div className="detail-body">
      <div className="kpis">
        <div>
          <small>主机</small>
          <b>{d.isDisabled ? "已停用" : d.isOnline ? "在线" : "离线"}</b>
        </div>
        <div>
          <small>SIP</small>
          <b style={{ color: m?.sipEnable && !m.isSipRegister ? "#D4380D" : undefined }}>{sipText}</b>
        </div>
        <div>
          <small>SIP 号</small>
          <b className="mono">{m?.sipUserName || "—"}</b>
        </div>
        <div>
          <small>通讯录</small>
          <b>{m?.deviceCount ?? 0} 台雷达</b>
        </div>
      </div>
      <div className="ops-grid">
        <div className="ops-card">
          <h2>基本信息</h2>
          <dl className="kv">
            <dt>所属机构</dt>
            <dd>{d.orgName || "—"}</dd>
            <dt>设备类型</dt>
            <dd>{typeName ?? "管理主机"}</dd>
            <dt>固件版本</dt>
            <dd className="mono">{d.firmwareVersion ?? "—"}</dd>
            <dt>IP</dt>
            <dd className="mono">{m?.ipAddress ?? "—"}</dd>
            <dt>添加时间</dt>
            <dd>{m?.createdAt ?? "—"}</dd>
          </dl>
        </div>
        <div className="ops-card">
          <h2>
            SIP 账号
            {m && <MasterSipActions m={m} onChanged={() => onChanged?.()} />}
          </h2>
          <dl className="kv">
            <dt>状态</dt>
            <dd>{sipText}</dd>
            <dt>SIP 号</dt>
            <dd className="mono">{m?.sipUserName || "—"}</dd>
            <dt>服务器</dt>
            <dd className="mono">{m?.sipServer || "—"}</dd>
            <dt>最近注册</dt>
            <dd>{fmt(m?.sipRegisterAt)}</dd>
            <dt>账号下发</dt>
            <dd>{m?.sipIssueStatus === 2 ? `已下发 ${m.sipIssueAt ?? ""}` : m?.sipEnable ? "未下发" : "—"}</dd>
          </dl>
          <p className="muted small" style={{ marginTop: 10 }}>
            主机和雷达都注册到 SIP 服务器后才能互相拨打。主机按"覆盖房间"的通讯录主动呼叫雷达；告警要打到主机，就在雷达的通话页把紧急号码或备用号码选成这台主机。
          </p>
        </div>
      </div>
      <div className="dev-danger">
        <Button danger icon={<DeleteOutlined />} onClick={() => setDeleting(true)}>
          删除设备
        </Button>
        <span className="muted small">覆盖房间和通讯录会一起解除</span>
      </div>
    </div>
  );

  return (
    <div className="detail">
      <DetailHead
        d={d}
        listHidden={listHidden}
        onToggleList={onToggleList}
        onRenamed={onChanged}
        sub={[typeName ?? "管理主机", m?.ipAddress && `IP ${m.ipAddress}`, m?.sipUserName && `SIP ${m.sipUserName}`]}
      />
      <Tabs
        className="detail-tabs"
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden
        items={[
          { key: "overview", label: "概览", children: overview },
          { key: "rooms", label: "覆盖房间", children: <MasterRooms d={d} radars={radars} onSaved={onChanged} /> },
          { key: "calls", label: "通话记录", children: <CallRecords sn={d.sn} sip={m?.sipUserName} orgId={d.orgId} /> },
          { key: "log", label: "通信日志", children: <LogTable sn={d.sn} /> },
        ]}
      />
      <DeleteOtherDialog
        d={d}
        open={deleting}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          setDeleting(false);
          onDeleted?.();
        }}
      />
    </div>
  );
}
