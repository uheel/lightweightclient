import type { ReactNode } from "react";
import { Button, Checkbox, Input, Popconfirm, Select, Switch } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EyeInvisibleOutlined, EyeOutlined, PlusOutlined, UndoOutlined } from "@ant-design/icons";
import { GROUPS, MODULES } from "../workspace/modules";
import { addGroup, moveGroup, NAME_MAX, removeGroup, resetNames, setGroup, setName, toggleHidden, UNHIDEABLE, useNames, type GroupId } from "../workspace/names";
import { ModuleName } from "../workspace/ModuleName";
import { ALERT_GROUPS } from "../api/device";
import { setPopupSettings, usePopupSettings } from "../alerts/popupSettings";

/** 系统设置：告警弹窗开关；工作台的类别和模块：改名字、换类别、调顺序、新增空类别、隐藏（存在本机，工作台和标题栏标签立即生效） */
export default function SettingsPage() {
  const names = useNames();
  const changed = [names.raw.groups, names.raw.modules, names.raw.moves, names.raw.order, names.raw.added, names.raw.hiddenGroups, names.raw.hiddenModules].some((m) => Object.keys(m ?? {}).length);
  const groupOptions = names.layout.map((g) => ({ value: g.key, label: names.group(g.key) }));

  return (
    <div className="page">
      <div className="page-head">
        <h1><ModuleName k="settings" /></h1>
      </div>
      <AlertPopupCard />
      <div className="ops-card settings-names">
        <h2>
          类别和模块
          <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
            改工作台上类别和模块方块、标题栏标签显示的名字，调整类别顺序，新增类别，把模块换到别的类别，或在工作台上隐藏，只存在这台电脑上；名字清空恢复默认
          </span>
          <Button size="small" icon={<PlusOutlined />} onClick={() => addGroup()} style={{ marginLeft: "auto" }}>
            新增类别
          </Button>
          <Popconfirm title="名字、类别和隐藏都恢复默认？新增的类别会删掉" onConfirm={resetNames} disabled={!changed}>
            <Button size="small" icon={<UndoOutlined />} disabled={!changed}>
              全部恢复默认
            </Button>
          </Popconfirm>
        </h2>
        {/* 类别按工作台上的顺序列，模块列在它现在所在的类别下 */}
        {names.layout.map((grp, i) => (
          <section key={grp.key} className="settings-group">
            <NameField
              label="类别"
              // 新增的类别没有默认名：框里就是它的名字，空着时提示起名
              def={names.isAdded(grp.key) ? "" : GROUPS.find((g) => g.key === grp.key)!.title}
              placeholder={names.isAdded(grp.key) ? "输入类别名称" : undefined}
              value={names.isAdded(grp.key) ? names.raw.added?.find((g) => g.key === grp.key)?.title : names.raw.groups?.[grp.key]}
              onChange={(v) => setName("groups", grp.key, v)}
              hidden={names.groupHidden(grp.key)}
            >
              <HideButton
                hidden={names.groupHidden(grp.key)}
                locked={grp.keys.includes(UNHIDEABLE) ? "系统设置所在的类别不能隐藏" : undefined}
                onClick={() => toggleHidden("hiddenGroups", grp.key)}
              />
              <Button size="small" type="text" icon={<ArrowUpOutlined />} title="上移" disabled={i === 0} onClick={() => moveGroup(grp.key, -1)} />
              <Button size="small" type="text" icon={<ArrowDownOutlined />} title="下移" disabled={i === names.layout.length - 1} onClick={() => moveGroup(grp.key, 1)} />
              {names.isAdded(grp.key) &&
                (grp.keys.length ? (
                  <Popconfirm title={`删除类别？里面的 ${grp.keys.length} 个模块回到原来的类别`} onConfirm={() => removeGroup(grp.key)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} title="删除类别" />
                  </Popconfirm>
                ) : (
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} title="删除类别" onClick={() => removeGroup(grp.key)} />
                ))}
            </NameField>
            <div className="settings-modules">
              {grp.keys.length ? (
                grp.keys.map((k) => (
                  <NameField
                    key={k}
                    icon={MODULES[k].icon}
                    color={MODULES[k].color}
                    def={MODULES[k].label}
                    value={names.raw.modules?.[k]}
                    onChange={(v) => setName("modules", k, v)}
                    // 类别隐藏了，里面的模块也看不到
                    hidden={names.moduleHidden(k) || names.groupHidden(grp.key)}
                  >
                    <HideButton hidden={names.moduleHidden(k)} locked={k === UNHIDEABLE ? "系统设置不能隐藏" : undefined} onClick={() => toggleHidden("hiddenModules", k)} />
                    <Select
                      size="small"
                      className="settings-name-group"
                      title="所在类别"
                      value={grp.key}
                      options={groupOptions}
                      onChange={(g: GroupId) => setGroup(k, g)}
                      popupMatchSelectWidth={false}
                    />
                  </NameField>
                ))
              ) : (
                <span className="muted settings-empty">没有模块，工作台上不显示这个类别；在模块后面选类别可以把模块换过来</span>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** 告警弹窗：默认关闭；打开后有新告警时应用内右下角提醒，窗口不在前台时屏幕右下角弹窗、响提示音、任务栏闪烁 */
function AlertPopupCard() {
  const p = usePopupSettings();
  return (
    <div className="ops-card settings-popup">
      <h2>
        告警弹窗
        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
          打开后，当前机构有新告警时在右下角提醒；窗口最小化或切到别的程序时，在屏幕右下角弹窗、响提示音、任务栏闪烁。打开时已有的告警不提醒。只存在这台电脑上
        </span>
      </h2>
      <div className="settings-popup-row">
        <Switch checked={p.enabled} onChange={(enabled) => setPopupSettings({ enabled })} />
        <span>{p.enabled ? "已开启" : "已关闭"}</span>
      </div>
      <div className="settings-popup-row">
        <span>提醒哪些告警</span>
        <Checkbox.Group
          disabled={!p.enabled}
          value={p.groups}
          options={ALERT_GROUPS}
          onChange={(groups) => setPopupSettings({ groups: groups as number[] })}
        />
        {p.enabled && !p.groups.length && <span className="muted">一类都没选，不会提醒</span>}
      </div>
    </div>
  );
}

function NameField({
  label,
  icon,
  color,
  def,
  placeholder,
  value,
  onChange,
  hidden,
  children,
}: {
  label?: string;
  icon?: ReactNode;
  color?: string;
  def: string;
  /** 不填就用默认名 */
  placeholder?: string;
  value?: string;
  onChange: (v: string) => void;
  /** 工作台上不显示：整行变淡 */
  hidden?: boolean;
  /** 名字框后面的其他控件（类别的上移下移、模块的所在类别） */
  children?: ReactNode;
}) {
  return (
    <div className={`settings-name${hidden ? " is-hidden" : ""}`}>
      <span className="settings-name-tag" style={{ color }}>
        {icon ?? label}
      </span>
      <Input
        size="small"
        // 没改过就显示空框 + 默认名占位，一眼看出哪些改过
        value={value ?? ""}
        placeholder={placeholder ?? def}
        maxLength={NAME_MAX}
        allowClear
        onChange={(e) => onChange(e.target.value)}
      />
      {children}
      {value && def && <span className="muted settings-name-def">默认：{def}</span>}
    </div>
  );
}

/** 显示 / 隐藏开关；locked 是不能隐藏的原因 */
function HideButton({ hidden, locked, onClick }: { hidden: boolean; locked?: string; onClick: () => void }) {
  return (
    <Button
      size="small"
      type="text"
      className="settings-hide"
      icon={hidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
      title={locked ?? (hidden ? "工作台上已隐藏，点击显示" : "在工作台上隐藏")}
      disabled={!!locked}
      onClick={onClick}
    />
  );
}
