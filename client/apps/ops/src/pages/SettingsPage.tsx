import type { ReactNode } from "react";
import { Button, Input, Popconfirm, Select } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, UndoOutlined } from "@ant-design/icons";
import { GROUPS, MODULES, type GroupKey } from "../workspace/modules";
import { moveGroup, NAME_MAX, resetNames, setGroup, setName, useNames } from "../workspace/names";

/** 系统设置：目前只有工作台类别、模块的自定义名字和模块所在类别（存在本机，工作台和标题栏标签立即生效） */
export default function SettingsPage() {
  const names = useNames();
  const changed = [names.raw.groups, names.raw.modules, names.raw.moves, names.raw.order].some((m) => Object.keys(m ?? {}).length);
  const groupOptions = names.layout.map((g) => ({ value: g.key, label: names.group(g.key) }));

  return (
    <div className="page">
      <div className="page-head">
        <h1>系统设置</h1>
      </div>
      <div className="ops-card settings-names">
        <h2>
          类别和模块
          <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
            改工作台上类别和模块方块、标题栏标签显示的名字，调整类别顺序，或把模块换到别的类别，只存在这台电脑上；名字清空恢复默认
          </span>
          <Popconfirm title="名字和类别都恢复默认？" onConfirm={resetNames} disabled={!changed}>
            <Button size="small" icon={<UndoOutlined />} disabled={!changed} style={{ marginLeft: "auto" }}>
              全部恢复默认
            </Button>
          </Popconfirm>
        </h2>
        {/* 类别按工作台上的顺序列，模块列在它现在所在的类别下 */}
        {names.layout.map((grp, i) => (
          <section key={grp.key} className="settings-group">
            <NameField label="类别" def={GROUPS.find((g) => g.key === grp.key)!.title} value={names.raw.groups?.[grp.key]} onChange={(v) => setName("groups", grp.key, v)}>
              <Button size="small" type="text" icon={<ArrowUpOutlined />} title="上移" disabled={i === 0} onClick={() => moveGroup(grp.key, -1)} />
              <Button size="small" type="text" icon={<ArrowDownOutlined />} title="下移" disabled={i === names.layout.length - 1} onClick={() => moveGroup(grp.key, 1)} />
            </NameField>
            <div className="settings-modules">
              {grp.keys.length ? (
                grp.keys.map((k) => (
                  <NameField key={k} icon={MODULES[k].icon} color={MODULES[k].color} def={MODULES[k].label} value={names.raw.modules?.[k]} onChange={(v) => setName("modules", k, v)}>
                    <Select
                      size="small"
                      className="settings-name-group"
                      title="所在类别"
                      value={grp.key}
                      options={groupOptions}
                      onChange={(g: GroupKey) => setGroup(k, g)}
                      popupMatchSelectWidth={false}
                    />
                  </NameField>
                ))
              ) : (
                <span className="muted settings-empty">没有模块，工作台上不显示这个类别</span>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function NameField({
  label,
  icon,
  color,
  def,
  value,
  onChange,
  children,
}: {
  label?: string;
  icon?: ReactNode;
  color?: string;
  def: string;
  value?: string;
  onChange: (v: string) => void;
  /** 名字框后面的其他控件（类别的上移下移、模块的所在类别） */
  children?: ReactNode;
}) {
  return (
    <div className="settings-name">
      <span className="settings-name-tag" style={{ color }}>
        {icon ?? label}
      </span>
      <Input
        size="small"
        // 没改过就显示空框 + 默认名占位，一眼看出哪些改过
        value={value ?? ""}
        placeholder={def}
        maxLength={NAME_MAX}
        allowClear
        onChange={(e) => onChange(e.target.value)}
      />
      {children}
      {value && <span className="muted settings-name-def">默认：{def}</span>}
    </div>
  );
}
