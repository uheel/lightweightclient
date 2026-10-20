import { useEffect, useState } from "react";
import { Select } from "antd";
import { getInstallAreas, INSTALL_AREAS, INSTALL_AREA, type InstallArea, type InstallAreaOption } from "./installArea";
import type { SlotSource } from "./radarSlot";

/** 雷达安装区域下拉（选项取平台字典）。换区域时别名跟着换成区域名，区域不变时保留原来的别名 */
export default function AreaSelect({
  value,
  onChange,
  size,
  disabled,
  loading,
  placeholder = "安装区域",
  style,
}: {
  value?: InstallArea;
  onChange: (a: InstallArea | null) => void;
  size?: "small" | "middle";
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [opts, setOpts] = useState<InstallAreaOption[]>(INSTALL_AREAS);
  useEffect(() => {
    getInstallAreas().then(setOpts);
  }, []);
  const options = [...opts];
  // 布置里存的编号不在字典里（字典改过）：也列出来，不然显示成数字
  if (value?.type !== undefined && !opts.some((o) => o.value === value.type)) options.push({ value: value.type, label: value.name || `区域 ${value.type}` });
  return (
    <Select
      allowClear
      size={size}
      disabled={disabled}
      loading={loading}
      placeholder={placeholder}
      value={value?.type}
      style={{ minWidth: 96, ...style }}
      popupMatchSelectWidth={false}
      options={options.map((o) => ({ value: o.value, label: value?.type === o.value && value.name && value.name !== o.label ? `${value.name}（${o.label}）` : o.label }))}
      onChange={(v?: number) => onChange(v === undefined || v === null ? null : { type: v, name: v === value?.type ? value?.name : INSTALL_AREA[v] })}
    />
  );
}

/** 放进布置时选安装区域；房间里已经有别的雷达时提醒选一下，分清哪台装在哪 */
export function SlotAreaLine({ slot, area, onChange }: { slot: SlotSource; area: InstallArea | null; onChange: (a: InstallArea | null) => void }) {
  return (
    <div className="slot-area">
      <span>装在</span>
      <AreaSelect size="small" value={area ?? undefined} onChange={onChange} placeholder="选择安装区域" style={{ width: 128 }} />
      <span className="muted small">
        {slot.peers > 0 ? `房间里已经有 ${slot.peers} 台雷达，选一下这台装在卧室还是卫生间等，告警和长者页才分得清` : "卧室、卫生间等；一个房间装几台雷达时靠它分清"}
      </span>
    </div>
  );
}
