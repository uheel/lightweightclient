import { useMemo } from "react";
import { Cascader } from "antd";

export interface TypeGroup {
  value: string;
  label: string;
  /** 这个大类下的具体型号 */
  types: { value: number; label: string }[];
}

/**
 * 选设备类型：输入框，点开后下方是大类 → 型号的多级联动，选到型号就填进框里、收起。
 * 当成表单控件用（value / onChange 是设备类型编号）
 */
export default function TypeCascader({ groups, value, onChange }: { groups: TypeGroup[]; value?: number; onChange?: (v: number | undefined) => void }) {
  // Cascader 的值统一用字符串，进出时和设备类型编号互转
  const options = useMemo(
    () => groups.map((g) => ({ value: g.value, label: g.label, children: g.types.map((t) => ({ value: String(t.value), label: t.label })) })),
    [groups],
  );
  const owner = groups.find((g) => g.types.some((t) => t.value === value))?.value;
  // 值要保持同一个数组：每次渲染给新数组，Cascader 会当成值变了，把展开的栏拉回已选的型号，点别的大类就跳回去
  const path = useMemo(() => (owner && value !== undefined ? [owner, String(value)] : undefined), [owner, value]);
  return (
    <Cascader
      options={options}
      value={path}
      onChange={(path) => onChange?.(path?.[1] !== undefined ? Number(path[1]) : undefined)}
      // 框里只显示型号；大类和型号同名（管理主机）时不重复
      displayRender={(labels) => labels[labels.length - 1]}
      placeholder="请选择"
      showSearch={{ filter: (input, path) => path.some((o) => String(o.label).toLowerCase().includes(input.toLowerCase())) }}
      style={{ width: "100%" }}
    />
  );
}
