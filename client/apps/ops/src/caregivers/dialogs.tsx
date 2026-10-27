import { useEffect, useMemo, useRef, useState } from "react";
import { App, Form, Input, InputNumber, Modal, Radio, Segmented, Select, Switch, Tree } from "antd";
import type { InputRef, TreeDataNode } from "antd";
import { CAREGIVER_TYPES, getCaregiver, getGroup, saveCaregiver, saveGroup, type Caregiver, type CaregiverGroup } from "../api/caregiver";
import { deviceLabel, floorLabel, groupByFloor, type DeviceSpot } from "./model";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 最近一次不为空的值 */
function useLast<T>(v: T | undefined) {
  const ref = useRef(v);
  if (v !== undefined) ref.current = v;
  return ref.current;
}

interface CaregiverValues {
  realName: string;
  code: string;
  type: number;
  answerCall: boolean;
  phone?: string;
  gender?: number;
  age?: number;
  description?: string;
  groupIds: string[];
}

/**
 * 新建 / 编辑护理员，顺便选所在的护理组（不用再到组里一个个加）。
 * 平台的修改是整份覆盖，编辑前先取详情，排序值这种表单里没有的字段原样带回去
 */
export function CaregiverDialog({
  target,
  groups,
  groupsOf,
  codes,
  onClose,
  onSaved,
}: {
  /** {} 是新建 */
  target?: { id?: string };
  groups: CaregiverGroup[];
  groupsOf: (caregiverId: string) => string[];
  /** 已有的编号（不含正在编辑的），本地先查重 */
  codes: Map<string, string>;
  onClose: () => void;
  onSaved: (c: Caregiver, groupIds: string[]) => Promise<void>;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<CaregiverValues>();
  const nameRef = useRef<InputRef>(null);
  const [orig, setOrig] = useState<Caregiver>();
  const [saving, setSaving] = useState(false);
  // 关闭动画期间 target 已经是空的，标题沿用打开时的，不闪成"新建"
  const id = useLast(target)?.id;

  useEffect(() => {
    if (!target) return;
    setOrig(undefined);
    form.resetFields();
    if (!id) {
      form.setFieldsValue({ type: 1, answerCall: true, groupIds: groups.length === 1 ? [groups[0].id] : [] });
      return;
    }
    getCaregiver(id).then(
      (c) => {
        setOrig(c);
        form.setFieldsValue({ ...c, groupIds: groupsOf(id) });
      },
      (e) => {
        message.error(`读取护理员失败：${errText(e)}`);
        onClose();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  async function submit() {
    const v = await form.validateFields();
    const code = v.code.trim();
    const dup = codes.get(code);
    if (dup && dup !== id) {
      form.setFields([{ name: "code", errors: ["这个编号已经有人用了"] }]);
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...(orig ?? { sortOrder: 0 }),
        realName: v.realName.trim(),
        code,
        type: v.type,
        answerCall: v.answerCall,
        phone: v.phone?.trim() || undefined,
        gender: v.gender,
        age: v.age ?? undefined,
        description: v.description?.trim() || undefined,
      };
      const newId = await saveCaregiver({ ...body, id });
      await onSaved({ ...body, id: newId } as Caregiver, v.groupIds ?? []);
    } catch (e) {
      message.error(`保存失败：${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!target}
      title={id ? "编辑护理员" : "新建护理员"}
      okText={id ? "保存" : "新建"}
      onOk={submit}
      confirmLoading={saving}
      okButtonProps={{ disabled: !!id && !orig }}
      onCancel={onClose}
      width={560}
      forceRender
      afterOpenChange={(o) => o && nameRef.current?.focus()}
    >
      <Form form={form} layout="vertical" className="cg-form">
        <Form.Item name="realName" label="姓名" rules={[{ required: true, whitespace: true, message: "填写姓名" }]}>
          <Input maxLength={32} ref={nameRef} />
        </Form.Item>
        <Form.Item name="code" label="编号" rules={[{ required: true, whitespace: true, message: "填写编号" }]} tooltip="不能和别人重复，例如工号">
          <Input maxLength={32} placeholder="例如：HG-012" />
        </Form.Item>
        <Form.Item name="type" label="类型">
          <Segmented options={CAREGIVER_TYPES} />
        </Form.Item>
        <Form.Item name="answerCall" label="接听来电" valuePropName="checked" tooltip="关掉后设备呼叫时不打给这位护理员（例如不值班的管理人员）">
          <Switch checkedChildren="接" unCheckedChildren="不接" />
        </Form.Item>
        <Form.Item name="phone" label="手机号" rules={[{ pattern: /^1\d{10}$/, message: "11 位手机号" }]}>
          <Input maxLength={11} />
        </Form.Item>
        <div className="cg-form-pair">
          <Form.Item name="gender" label="性别" rules={[{ required: true, message: "选择性别" }]}>
            {/* 必填但不给默认值，免得没留意就存成"男"（Segmented 没选时也会高亮第一项，所以用单选按钮） */}
            <Radio.Group optionType="button" options={[{ value: 1, label: "男" }, { value: 2, label: "女" }]} />
          </Form.Item>
          <Form.Item name="age" label="年龄">
            <InputNumber min={1} max={199} precision={0} suffix="岁" style={{ width: 120 }} />
          </Form.Item>
        </div>
        <Form.Item name="groupIds" label="所在护理组" className="cg-form-wide" extra={groups.length ? undefined : "还没有护理组，建好组后可以在这里选"}>
          <Select mode="multiple" allowClear placeholder="不选就是暂不分组" options={groups.map((g) => ({ value: g.id, label: g.groupName }))} optionFilterProp="label" />
        </Form.Item>
        <Form.Item name="description" label="备注" className="cg-form-wide">
          <Input.TextArea rows={2} maxLength={200} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** 新建 / 编辑护理组：名字和备注。列表可能不带备注，编辑前先取详情 */
export function GroupDialog({
  target,
  names,
  onClose,
  onSaved,
}: {
  /** {} 是新建 */
  target?: Partial<CaregiverGroup>;
  /** 已有的组名（不含正在编辑的） */
  names: Map<string, string>;
  onClose: () => void;
  onSaved: (g: CaregiverGroup) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ groupName: string; description?: string }>();
  const nameRef = useRef<InputRef>(null);
  const [saving, setSaving] = useState(false);
  const [orig, setOrig] = useState<Partial<CaregiverGroup>>();
  const editId = useLast(target)?.id;

  useEffect(() => {
    if (!target) return;
    form.resetFields();
    setOrig(target);
    form.setFieldsValue(target);
    if (target.id)
      getGroup(target.id).then(
        (g) => {
          setOrig({ ...target, ...g });
          form.setFieldsValue({ groupName: g.groupName, description: g.description });
        },
        () => {},
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  async function submit() {
    const v = await form.validateFields();
    const groupName = v.groupName.trim();
    const dup = names.get(groupName);
    if (dup && dup !== target?.id) {
      form.setFields([{ name: "groupName", errors: ["已经有这个组了"] }]);
      return;
    }
    setSaving(true);
    try {
      const g = { sortOrder: orig?.sortOrder ?? 0, groupName, description: v.description?.trim() || undefined };
      const id = await saveGroup({ ...g, id: target?.id });
      onSaved({ ...g, id });
    } catch (e) {
      message.error(`保存失败：${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!target} title={editId ? "编辑护理组" : "新建护理组"} okText={editId ? "保存" : "新建"} onOk={submit} confirmLoading={saving} onCancel={onClose} forceRender afterOpenChange={(o) => o && nameRef.current?.focus()}>
      <Form form={form} layout="vertical">
        <Form.Item name="groupName" label="组名" rules={[{ required: true, whitespace: true, message: "填写组名" }]}>
          <Input maxLength={32} placeholder="例如：3 楼白班" ref={nameRef} onPressEnter={submit} />
        </Form.Item>
        <Form.Item name="description" label="备注">
          <Input.TextArea rows={2} maxLength={200} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/**
 * 选护理组负责的设备：按 楼栋 · 楼层 › 房间 › 设备 的树勾选，勾楼层或房间就是整层 / 整间。
 * 设备后面标出它已经在哪些别的组里（一台设备可以同时在几个组）
 */
export function DevicePicker({
  open,
  title,
  spots,
  selected,
  otherGroups,
  onClose,
  onOk,
}: {
  open: boolean;
  title: string;
  spots: DeviceSpot[];
  selected: string[];
  /** 设备 id → 它所在的别的组名 */
  otherGroups: (deviceId: string) => string[];
  onClose: () => void;
  onOk: (ids: string[]) => Promise<void>;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setChecked(selected);
      setQ("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ids = useMemo(() => new Set(spots.map((s) => s.device.id)), [spots]);

  const tree = useMemo<TreeDataNode[]>(() => {
    const kw = q.trim().toLowerCase();
    const hit = (s: DeviceSpot) => !kw || [s.device.deviceName, s.device.sn, s.room, floorLabel(s)].some((v) => v?.toLowerCase().includes(kw));
    return groupByFloor(spots.filter(hit)).map((f) => ({
      key: `f:${f.label}`,
      title: <b>{f.label}</b>,
      children: f.rooms.map((r) => ({
        key: `r:${f.label}:${r.room}`,
        title: r.room,
        children: r.spots.map((s) => {
          const others = otherGroups(s.device.id);
          return {
            key: s.device.id,
            title: (
              <span className="cg-pick-dev">
                {deviceLabel(s.device)}
                {s.device.deviceName && s.device.deviceName !== s.device.sn && <span className="mono muted">{s.device.sn}</span>}
                {others.length > 0 && <span className="cg-pick-other">也在 {others.join("、")}</span>}
              </span>
            ),
          };
        }),
      })),
    }));
  }, [spots, q, otherGroups]);

  // 搜索时只改看得到的设备，看不到的保持原来的勾选
  const visible = useMemo(() => new Set(tree.flatMap((f) => f.children!.flatMap((r) => r.children!.map((d) => String(d.key))))), [tree]);

  return (
    <Modal
      open={open}
      title={title}
      okText={`确定（${checked.length} 台）`}
      onOk={async () => {
        setSaving(true);
        try {
          await onOk(checked);
        } finally {
          setSaving(false);
        }
      }}
      confirmLoading={saving}
      onCancel={onClose}
      width={600}
      destroyOnHidden
    >
      <Input.Search allowClear placeholder="设备名 / SN / 房间 / 楼层" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="cg-pick-tree">
        {tree.length ? (
          <Tree
            checkable
            selectable={false}
            defaultExpandAll
            key={q}
            treeData={tree}
            checkedKeys={checked.filter((k) => visible.has(k))}
            onCheck={(keys) => {
              const now = new Set((Array.isArray(keys) ? keys : keys.checked).map(String).filter((k) => ids.has(k)));
              setChecked((prev) => [...prev.filter((k) => !visible.has(k)), ...[...visible].filter((k) => now.has(k))]);
            }}
          />
        ) : (
          <div className="muted" style={{ padding: 24, textAlign: "center" }}>
            {spots.length ? "没有符合的设备" : "机构里还没有雷达"}
          </div>
        )}
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>
        只列雷达（管理主机等其他设备不能加进护理组）；勾选楼层或房间会选中下面全部雷达
      </div>
    </Modal>
  );
}
