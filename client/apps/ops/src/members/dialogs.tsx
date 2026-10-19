import { useEffect, useMemo, useState } from "react";
import { App, DatePicker, Form, Input, InputNumber, Modal, Select } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import {
  adjustBed,
  checkIn,
  checkOut,
  CHECKOUT_REASONS,
  createMember,
  findMemberByPhone,
  getMember,
  getMemberDetail,
  swapBed,
  updateMember,
  type Bed,
  type CodeOption,
  type MemberRow,
  type NewMember,
} from "../api/member";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const byName = (a: string, b: string) => a.localeCompare(b, "zh-CN", { numeric: true });

export interface MemberDicts {
  idTypes: CodeOption[];
  memberTypes: CodeOption[];
  relations: CodeOption[];
}

/** 空床按 楼栋 › 楼层 分组，给下拉框用 */
export function freeBedOptions(beds: Bed[], except?: string) {
  const groups = new Map<string, { label: string; value: string }[]>();
  for (const b of beds) {
    if (b.memberId || b.bedId === except) continue;
    const g = `${b.building} › ${b.floor}`;
    const arr = groups.get(g) ?? [];
    // 选中后框里只显示 label，所以带上完整位置（不同楼栋常有同名的 101-1床）
    arr.push({ value: b.bedId, label: `${g} › ${b.roomName} › ${b.bedName}` });
    groups.set(g, arr);
  }
  return [...groups.entries()].sort((a, b) => byName(a[0], b[0])).map(([label, options]) => ({ label, options: options.sort((a, b) => byName(a.label, b.label)) }));
}

const GENDERS = [
  { value: 1, label: "男" },
  { value: 2, label: "女" },
];

interface FormValues {
  realName: string;
  phoneNumber: string;
  gender?: number;
  age?: number;
  birthDate?: Dayjs;
  idType?: number;
  idNumber?: string;
  memberType?: number;
  height?: number;
  weight?: number;
  address?: string;
  bedId?: string;
  checkInDate?: Dayjs;
}

const toMember = (v: FormValues): NewMember => ({
  realName: v.realName.trim(),
  phoneNumber: v.phoneNumber.replace(/[\s-]/g, ""),
  gender: v.gender,
  age: v.age,
  birthDate: v.birthDate?.format("YYYY-MM-DD"),
  idType: v.idType,
  idNumber: v.idNumber?.trim() || undefined,
  memberType: v.memberType,
  height: v.height,
  weight: v.weight,
  address: v.address?.trim() || undefined,
});

/**
 * 新建 / 修改长者资料。新建时可以顺便选床办入住。
 * 平台按手机号识别长者：新建前先在本机构按手机号查，已有就直接打开那位；手机号属于别的机构的长者时平台不会新建，返回的是那位长者。
 */
export function MemberFormDialog({
  open,
  memberId,
  beds,
  dicts,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** 有值 = 修改 */
  memberId?: string;
  beds: Bed[];
  dicts: MemberDicts;
  onClose: () => void;
  /** 保存后要选中的长者 */
  onSaved: (id: string) => void;
}) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const bedId = Form.useWatch("bedId", form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (!memberId) return form.setFieldsValue({ checkInDate: dayjs() });
    setLoading(true);
    getMemberDetail(memberId).then(
      (d) => {
        if (!d) return;
        form.setFieldsValue({
          realName: d.realName,
          phoneNumber: (d.phoneNumber as string) ?? "",
          gender: d.gender as number | undefined,
          age: d.age as number | undefined,
          birthDate: d.birthDate ? dayjs(d.birthDate as string) : undefined,
          idType: d.idType !== undefined ? Number(d.idType) : undefined,
          idNumber: d.idNumber as string | undefined,
          memberType: d.memberType !== undefined ? Number(d.memberType) : undefined,
          height: d.height as number | undefined,
          weight: d.weight as number | undefined,
          address: d.address as string | undefined,
        });
      },
      (e) => message.error(`读取资料失败：${errText(e)}`),
    ).finally(() => setLoading(false));
  }, [open, memberId, form, message]);

  async function submit() {
    const v = await form.validateFields();
    const m = toMember(v);
    setSaving(true);
    try {
      if (memberId) {
        await updateMember(memberId, m);
        message.success("资料已保存");
        onSaved(memberId);
        return;
      }
      const hit = await findMemberByPhone(m.phoneNumber);
      if (hit) {
        modal.info({ title: "这个手机号已经登记过", content: `本机构已有长者"${hit.realName}"用这个手机号，已为你打开。` });
        onSaved(hit.memberId);
        return;
      }
      const id = await createMember(m);
      const got = await getMember(id);
      if (got && got.realName !== m.realName) {
        modal.warning({
          title: "手机号属于另一位长者",
          content: `平台按手机号认人：这个手机号已经是"${got.realName}"（可能在别的机构登记），平台没有新建，也没有改他的资料。请换一个手机号。`,
        });
        onSaved(id);
        return;
      }
      if (v.bedId) {
        try {
          await checkIn(id, v.bedId, (v.checkInDate ?? dayjs()).format("YYYY-MM-DD"));
        } catch (e) {
          message.warning(`已建档，但入住失败：${errText(e)}`);
          onSaved(id);
          return;
        }
      }
      message.success(v.bedId ? "已建档并办理入住" : "已建档");
      onSaved(id);
    } catch (e) {
      message.error(`保存失败：${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const codeOpts = (list: CodeOption[]) => list.map((c) => ({ value: Number(c.value), label: c.label }));

  return (
    <Modal open={open} width={620} title={memberId ? "修改资料" : "新建长者"} okText="保存" confirmLoading={saving} onOk={submit} onCancel={onClose} destroyOnHidden>
      <Form form={form} layout="vertical" className="mem-form" disabled={loading} requiredMark="optional">
        <Form.Item name="realName" label="姓名" rules={[{ required: true, whitespace: true, message: "填姓名" }]}>
          <Input maxLength={32} autoFocus={!memberId} />
        </Form.Item>
        <Form.Item
          name="phoneNumber"
          label="手机号"
          extra={memberId ? undefined : "平台按手机号认人，已登记过的会直接打开"}
          rules={[{ required: true, message: "填手机号" }, { pattern: /^[\d\s-]{6,20}$/, message: "只填数字" }]}
        >
          <Input maxLength={20} />
        </Form.Item>
        <Form.Item name="gender" label="性别">
          <Select allowClear options={GENDERS} />
        </Form.Item>
        <Form.Item name="age" label="年龄">
          <InputNumber min={0} max={130} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="birthDate" label="出生日期">
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="memberType" label="老人分类">
          <Select allowClear options={codeOpts(dicts.memberTypes)} />
        </Form.Item>
        <Form.Item name="idType" label="证件类型">
          <Select allowClear options={codeOpts(dicts.idTypes)} />
        </Form.Item>
        <Form.Item name="idNumber" label="证件号码">
          <Input maxLength={32} />
        </Form.Item>
        <Form.Item name="height" label="身高 cm">
          <InputNumber min={0} max={250} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="weight" label="体重 kg">
          <InputNumber min={0} max={300} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="address" label="地址" className="mem-form-wide">
          <Input maxLength={128} />
        </Form.Item>
        {!memberId && (
          <>
            <Form.Item name="bedId" label="入住床位" extra="不选就只建档，之后再办入住">
              <Select allowClear showSearch optionFilterProp="label" placeholder="选一张空床" options={freeBedOptions(beds)} />
            </Form.Item>
            <Form.Item name="checkInDate" label="入住日期">
              <DatePicker style={{ width: "100%" }} disabled={!bedId} />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}

/** 办入住 / 调床：都只能选空床（平台调床不拦有人的床，会把原来的人挤掉；换到有人的床用"对调"） */
export function BedDialog({
  target,
  beds,
  onClose,
  onDone,
}: {
  target?: { kind: "check-in" | "adjust"; member: MemberRow; current?: Bed };
  beds: Bed[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [bedId, setBedId] = useState<string>();
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBedId(undefined);
    setDate(dayjs());
    setNote("");
  }, [target]);
  const options = useMemo(() => freeBedOptions(beds, target?.current?.bedId), [beds, target]);
  if (!target) return null;
  const adjust = target.kind === "adjust";

  async function run() {
    if (!target || !bedId) return;
    setBusy(true);
    try {
      if (adjust) await adjustBed(target.member.id, bedId, note.trim() || undefined);
      else await checkIn(target.member.id, bedId, date.format("YYYY-MM-DD"));
      message.success(adjust ? "已调床" : "已办理入住");
      onDone();
    } catch (e) {
      message.error(`${adjust ? "调床" : "入住"}失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`${adjust ? "调床" : "办理入住"}：${target.member.realName}`} okText={adjust ? "调床" : "入住"} okButtonProps={{ disabled: !bedId }} confirmLoading={busy} onOk={run} onCancel={onClose} destroyOnHidden>
      <div className="space-form">
        {adjust && target.current && (
          <>
            <label>现在</label>
            <span>
              {target.current.building} › {target.current.floor} › {target.current.roomName} › {target.current.bedName}
            </span>
          </>
        )}
        <label>{adjust ? "调到" : "床位"}</label>
        <Select showSearch autoFocus optionFilterProp="label" placeholder="选一张空床" value={bedId} onChange={setBedId} options={options} notFoundContent="没有空床，先到楼宇页加床位" />
        {adjust ? (
          <>
            <label>说明</label>
            <Input maxLength={200} placeholder="可不填" value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        ) : (
          <>
            <label>入住日期</label>
            <DatePicker value={date} onChange={(d) => d && setDate(d)} allowClear={false} />
          </>
        )}
      </div>
    </Modal>
  );
}

/** 和另一位已入住的长者对调床位 */
export function SwapDialog({
  member,
  others,
  bedOf,
  onClose,
  onDone,
}: {
  member?: MemberRow;
  /** 已入住的其他长者 */
  others: MemberRow[];
  bedOf: (id: string) => Bed | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [other, setOther] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => setOther(undefined), [member]);
  if (!member) return null;
  const mine = bedOf(member.id);

  async function run() {
    if (!member || !other) return;
    setBusy(true);
    try {
      await swapBed(member.id, other, "运维端对调");
      message.success("已对调");
      onDone();
    } catch (e) {
      message.error(`对调失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`对调床位：${member.realName}`} okText="对调" okButtonProps={{ disabled: !other }} confirmLoading={busy} onOk={run} onCancel={onClose} destroyOnHidden>
      <div className="space-form">
        <label>现在</label>
        <span>{mine ? `${mine.roomName} › ${mine.bedName}` : "—"}</span>
        <label>和谁对调</label>
        <Select
          showSearch
          autoFocus
          optionFilterProp="label"
          placeholder="选一位已入住的长者"
          value={other}
          onChange={setOther}
          options={others
            .filter((o) => o.id !== member.id && bedOf(o.id))
            .map((o) => {
              const b = bedOf(o.id)!;
              return { value: o.id, label: `${o.realName}（${b.building} › ${b.floor} › ${b.roomName} › ${b.bedName}）` };
            })}
        />
      </div>
    </Modal>
  );
}

export function CheckOutDialog({ member, onClose, onDone }: { member?: MemberRow; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [reason, setReason] = useState<number>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReason(undefined);
    setNote("");
  }, [member]);
  if (!member) return null;

  async function run() {
    if (!member || !reason) return;
    setBusy(true);
    try {
      await checkOut(member.id, reason, note.trim() || undefined);
      message.success("已办理退住");
      onDone();
    } catch (e) {
      message.error(`退住失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`办理退住：${member.realName}`} okText="退住" okButtonProps={{ disabled: !reason, danger: true }} confirmLoading={busy} onOk={run} onCancel={onClose} destroyOnHidden>
      <div className="space-form">
        <label>原因</label>
        <Select autoFocus placeholder="选择退住原因" value={reason} onChange={setReason} options={CHECKOUT_REASONS} />
        <label>说明</label>
        <Input.TextArea maxLength={200} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="可不填" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        退住后床位空出来，房间里的设备不再关联他；档案还在，之后可以再办入住。
      </p>
    </Modal>
  );
}
