import { useRef, useState, type ReactNode } from "react";
import { App, Button, Input, Popconfirm, Popover, Select } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EyeInvisibleOutlined, EyeOutlined, LinkOutlined, PlusOutlined, UndoOutlined, UploadOutlined } from "@ant-design/icons";
import { GROUPS, MODULES } from "../workspace/modules";
import {
  addGroup,
  addLink,
  isLink,
  linkUrl,
  moveGroup,
  NAME_MAX,
  removeGroup,
  removeLink,
  resetNames,
  setGroup,
  setIcon,
  setName,
  toggleHidden,
  updateLink,
  useNames,
  type GroupId,
  type ItemKey,
} from "../workspace/names";
import { BUILTIN_ICONS, ItemIcon, itemStyle, shrinkImage } from "../workspace/icons";
import { ModuleName } from "../workspace/ModuleName";

/**
 * 菜单设置：工作台的类别和模块：改名字、换图标、换类别、调顺序、新增空类别、隐藏；新增链接模块（点开在标签里显示第三方网址）。
 * 存在本机，工作台和标题栏标签立即生效
 */
export default function MenuSettingsPage() {
  const names = useNames();
  const changed = [names.raw.groups, names.raw.modules, names.raw.moves, names.raw.order, names.raw.added, names.raw.hiddenGroups, names.raw.hiddenModules, names.raw.shownModules, names.raw.icons].some((m) => Object.keys(m ?? {}).length);
  const groupOptions = names.layout.map((g) => ({ value: g.key, label: names.group(g.key) }));

  return (
    <div className="page">
      <div className="page-head">
        <h1><ModuleName k="menus" /></h1>
      </div>
      <div className="ops-card settings-names">
        <h2>
          类别和模块
          <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
            改工作台上类别和模块方块、标题栏标签显示的名字和图标（点图标换），调整类别顺序，新增类别和链接模块，把模块换到别的类别，或在工作台上隐藏（系统设置默认隐藏，从右上角用户菜单进；菜单设置隐藏后从系统设置里进），只存在这台电脑上；名字清空恢复默认
          </span>
          <Button size="small" icon={<PlusOutlined />} onClick={() => addGroup()} style={{ marginLeft: "auto" }}>
            新增类别
          </Button>
          <Popconfirm title="名字、图标、类别和隐藏都恢复默认？新增的类别会删掉，链接模块保留" onConfirm={resetNames} disabled={!changed}>
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
                onClick={() => toggleHidden("hiddenGroups", grp.key)}
              />
              <Button size="small" type="text" icon={<LinkOutlined />} title="在这个类别里新增链接模块，点开显示填的网址" onClick={() => addLink(grp.key)}>
                链接
              </Button>
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
                grp.keys.map((k) => {
                  const link = isLink(k) ? names.link(k) : undefined;
                  const badUrl = !!link?.url.trim() && !linkUrl(link.url);
                  return (
                    <NameField
                      key={k}
                      // 链接模块多一个网址框和删除按钮，单独占一整行，不然挤出边缘
                      wide={isLink(k)}
                      icon={<IconPicker k={k} />}
                      def={isLink(k) ? "" : MODULES[k].label}
                      placeholder={link ? "链接名称" : undefined}
                      value={isLink(k) ? link?.title : names.raw.modules?.[k]}
                      onChange={(v) => (isLink(k) ? updateLink(k, { title: v }) : setName("modules", k, v))}
                      // 类别隐藏了，里面的模块也看不到
                      hidden={names.moduleHidden(k) || names.groupHidden(grp.key)}
                    >
                      {link && (
                        <Input
                          size="small"
                          className="settings-link-url"
                          placeholder="https://… 点开后显示的网址"
                          status={badUrl || !link.url.trim() ? "warning" : undefined}
                          title={badUrl ? "不像网址" : !link.url.trim() ? "还没填网址" : link.url}
                          value={link.url}
                          onChange={(e) => updateLink(link.key, { url: e.target.value })}
                        />
                      )}
                      <HideButton hidden={names.moduleHidden(k)} onClick={() => toggleHidden("hiddenModules", k)} />
                      <Select
                        size="small"
                        className="settings-name-group"
                        title="所在类别"
                        value={grp.key}
                        options={groupOptions}
                        onChange={(g: GroupId) => setGroup(k, g)}
                        popupMatchSelectWidth={false}
                      />
                      {link && (
                        <Popconfirm title="删除这个链接模块？" onConfirm={() => removeLink(link.key)}>
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} title="删除链接模块" />
                        </Popconfirm>
                      )}
                    </NameField>
                  );
                })
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

/** 点模块图标换图标：从内置图标库里选，或上传图片（缩成 64×64 存在本机），可恢复默认 */
function IconPicker({ k }: { k: ItemKey }) {
  const { message } = App.useApp();
  const names = useNames();
  const [open, setOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const cur = names.icon(k);
  const st = itemStyle(k);
  const pick = (c: Parameters<typeof setIcon>[1]) => {
    setIcon(k, c);
    setOpen(false);
  };

  async function upload(f: File | undefined) {
    if (!f) return;
    try {
      pick({ image: await shrinkImage(f) });
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomLeft"
      content={
        <div className="icon-picker">
          <div className="icon-picker-grid">
            {Object.entries(BUILTIN_ICONS).map(([name, node]) => (
              <button key={name} className={cur && "builtin" in cur && cur.builtin === name ? "active" : undefined} onClick={() => pick({ builtin: name })}>
                {node}
              </button>
            ))}
          </div>
          <div className="icon-picker-foot">
            <Button size="small" icon={<UploadOutlined />} onClick={() => file.current?.click()}>
              上传图片
            </Button>
            <Button size="small" type="text" disabled={!cur} onClick={() => pick(undefined)}>
              恢复默认
            </Button>
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      }
    >
      <button className="settings-icon-btn" title="换图标" style={{ background: st.tint, color: st.color }}>
        <ItemIcon k={k} />
      </button>
    </Popover>
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
  wide,
  children,
}: {
  /** 占模块列表的一整行 */
  wide?: boolean;
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
    <div className={`settings-name${hidden ? " is-hidden" : ""}${wide ? " is-wide" : ""}`}>
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
