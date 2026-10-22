import { Tabs } from "antd";
import DetailHead from "./DetailHead";
import LogTable from "./LogTable";
import { catLabel, type DevRow } from "./category";

/** 外设、手表、戒指等还没有专门页面的设备：基本信息 + 通信日志 */
export default function BasicDetail({
  d,
  typeName,
  listHidden,
  onToggleList,
  onRenamed,
}: {
  d: DevRow;
  typeName?: string;
  listHidden: boolean;
  onToggleList: () => void;
  onRenamed?: () => void;
}) {
  const overview = (
    <div className="detail-body">
      <div className="ops-card" style={{ maxWidth: 560 }}>
        <h2>基本信息</h2>
        <dl className="kv">
          <dt>所属机构</dt>
          <dd>{d.orgName || "—"}</dd>
          <dt>分类</dt>
          <dd>{catLabel(d.cat)}</dd>
          <dt>设备类型</dt>
          <dd>{typeName ?? d.deviceType ?? "—"}</dd>
          <dt>固件版本</dt>
          <dd className="mono">{d.firmwareVersion ?? "—"}</dd>
          <dt>状态</dt>
          <dd>{d.isDisabled ? "已停用" : d.isOnline ? "在线" : "离线"}（平台记录）</dd>
        </dl>
      </div>
    </div>
  );
  return (
    <div className="detail">
      <DetailHead d={d} listHidden={listHidden} onToggleList={onToggleList} onRenamed={onRenamed} sub={[typeName ?? catLabel(d.cat)]} />
      <Tabs
        className="detail-tabs"
        destroyOnHidden
        items={[
          { key: "overview", label: "概览", children: overview },
          { key: "log", label: "通信日志", children: <LogTable sn={d.sn} /> },
        ]}
      />
    </div>
  );
}
