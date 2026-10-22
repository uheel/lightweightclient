import type { ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import NameEdit from "./NameEdit";
import type { DevRow } from "./category";

/** 非雷达设备详情的标题：收起列表、就地改名、在线状态，下面一行放 SN 等 */
export default function DetailHead({
  d,
  listHidden,
  onToggleList,
  onRenamed,
  sub,
}: {
  d: DevRow;
  listHidden: boolean;
  onToggleList: () => void;
  onRenamed?: () => void;
  sub: ReactNode[];
}) {
  const statusCls = d.isDisabled ? "disabled" : d.isOnline ? "online" : "offline";
  const statusText = d.isDisabled ? "已停用" : d.isOnline ? "在线" : "离线";
  return (
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
        <NameEdit d={d} onRenamed={onRenamed} />
        <span className={`status-tag ${statusCls}`} title="平台记录的在线状态">
          {statusText}
        </span>
      </div>
      <div className="detail-sub">
        <span>
          SN <span className="mono">{d.sn}</span>
        </span>
        {sub.filter(Boolean).map((s, i) => (
          <span key={i}>{s}</span>
        ))}
      </div>
    </div>
  );
}
