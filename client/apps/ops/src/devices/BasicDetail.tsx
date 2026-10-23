import { useState } from "react";
import { Button, Tabs } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import DeleteOtherDialog from "./DeleteOtherDialog";
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
  onDeleted,
}: {
  d: DevRow;
  typeName?: string;
  listHidden: boolean;
  onToggleList: () => void;
  onRenamed?: () => void;
  /** 设备删掉了，列表要去掉它 */
  onDeleted?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
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
      <div className="dev-danger">
        <Button danger icon={<DeleteOutlined />} onClick={() => setDeleting(true)}>
          删除设备
        </Button>
        <span className="muted small">长者上的关联会一起解除</span>
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
