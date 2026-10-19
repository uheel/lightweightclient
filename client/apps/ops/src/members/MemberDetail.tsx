import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Empty, Input, Popconfirm, Select, Space, Spin } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, SwapOutlined } from "@ant-design/icons";
import {
  addRelative,
  bindMemberDevice,
  getMemberDetail,
  getMemberDeviceCandidates,
  getMemberDevices,
  getRelatives,
  removeRelative,
  unbindMemberDevice,
  type Bed,
  type MemberDetail as Detail,
  type MemberDevice,
  type MemberRow,
  type Relative,
} from "../api/member";
import type { MemberDicts } from "./dialogs";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const GENDER: Record<number, string> = { 1: "男", 2: "女" };

export type MemberState = "in" | "registered" | "out" | "lost";

export const STATE_TEXT: Record<MemberState, string> = {
  in: "已入住",
  registered: "未入住",
  out: "已退住",
  lost: "床位丢失",
};

/** 入住状态以床位一侧为准（长者列表里的床位调床后不更新）：床上有他 = 已入住；平台说已入住但哪张床都没有他 = 床位丢失 */
export function memberState(m: MemberRow, bed?: Bed): MemberState {
  if (bed) return "in";
  if (m.checkType === 2) return "lost";
  if (m.checkType === 3) return "out";
  return "registered";
}

/** 长者详情：资料、入住、关联设备、亲友。进来时取详情、设备、亲友三样，其余操作完只刷新对应那块 */
export default function MemberDetail({
  member,
  bed,
  dicts,
  onEdit,
  onCheckIn,
  onAdjust,
  onSwap,
  onCheckOut,
  onDelete,
  onChanged,
}: {
  member: MemberRow;
  bed?: Bed;
  dicts: MemberDicts;
  onEdit: () => void;
  onCheckIn: () => void;
  onAdjust: () => void;
  onSwap: () => void;
  onCheckOut: () => void;
  onDelete: () => void;
  /** 加了亲友（平台会多一条长者记录），列表要刷新 */
  onChanged: () => void;
}) {
  const { message, modal } = App.useApp();
  const [detail, setDetail] = useState<Detail>();
  const [devices, setDevices] = useState<MemberDevice[]>();
  const [relatives, setRelatives] = useState<Relative[]>();
  const [cands, setCands] = useState<MemberDevice[]>();
  const [candLoading, setCandLoading] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [rel, setRel] = useState<{ realName: string; phoneNumber: string; relationshipType?: number }>({ realName: "", phoneNumber: "" });
  const [addingRel, setAddingRel] = useState(false);
  const state = memberState(member, bed);

  const loadDevices = useCallback(() => getMemberDevices(member.id).then(setDevices, () => setDevices([])), [member.id]);
  const loadRelatives = useCallback(() => getRelatives(member.id).then(setRelatives, () => setRelatives([])), [member.id]);

  useEffect(() => {
    setDetail(undefined);
    setDevices(undefined);
    setRelatives(undefined);
    setCands(undefined);
    getMemberDetail(member.id).then(setDetail, () => {});
    loadRelatives();
  }, [member.id, member.realName, member.age, loadRelatives]);

  // 入住、退住时平台会自动关联 / 取消关联房间里的设备，入住状态一变就重取
  useEffect(() => {
    setCands(undefined);
    loadDevices();
  }, [loadDevices, member.checkType, bed?.bedId]);

  const codeLabel = (list: { value: string; label: string }[], v: unknown) => (v === undefined || v === null ? undefined : list.find((c) => Number(c.value) === Number(v))?.label);

  async function loadCands() {
    if (cands || candLoading) return;
    setCandLoading(true);
    try {
      setCands(await getMemberDeviceCandidates(member.id));
    } catch (e) {
      message.error(`读取设备失败：${errText(e)}`);
    } finally {
      setCandLoading(false);
    }
  }

  async function bind(deviceId: string) {
    const d = cands?.find((x) => x.deviceId === deviceId);
    const owner = d?.owners?.find((o) => o.memberId !== member.id);
    const go = async (transfer: boolean) => {
      setBusy("bind");
      try {
        await bindMemberDevice(member.id, deviceId, transfer);
        message.success("已关联");
        setCands(undefined);
        await loadDevices();
      } catch (e) {
        message.error(`关联失败：${errText(e)}`);
      } finally {
        setBusy(undefined);
      }
    };
    if (owner)
      modal.confirm({
        title: "这台设备已经关联了别人",
        content: `${d?.deviceName || d?.sn} 现在关联的是"${owner.memberName}"。一台设备只能关联一位长者，转过来后"${owner.memberName}"就不再关联这台设备。`,
        okText: "转过来",
        onOk: () => go(true),
      });
    else await go(false);
  }

  async function unbind(d: MemberDevice) {
    try {
      await unbindMemberDevice(member.id, d.deviceId);
      message.success("已取消关联");
      setCands(undefined);
      await loadDevices();
    } catch (e) {
      message.error(`取消关联失败：${errText(e)}`);
    }
  }

  async function saveRelative() {
    if (!rel.realName.trim() || !rel.relationshipType) return;
    setBusy("rel");
    try {
      await addRelative(member.id, { realName: rel.realName.trim(), phoneNumber: rel.phoneNumber.replace(/[\s-]/g, "") || undefined, relationshipType: rel.relationshipType });
      setRel({ realName: "", phoneNumber: "" });
      setAddingRel(false);
      await loadRelatives();
      onChanged();
    } catch (e) {
      message.error(`添加亲友失败：${errText(e)}`);
    } finally {
      setBusy(undefined);
    }
  }

  async function dropRelative(r: Relative) {
    try {
      await removeRelative(member.id, r.memberId);
      await loadRelatives();
    } catch (e) {
      message.error(`解除失败：${errText(e)}`);
    }
  }

  const d = detail;
  const kv: [string, React.ReactNode][] = [
    ["手机号", (d?.phoneNumber as string) ?? member.phoneNumber],
    ["性别", GENDER[(d?.gender ?? member.gender) as number]],
    ["年龄", (d?.age ?? member.age) !== undefined ? `${d?.age ?? member.age} 岁` : undefined],
    ["出生日期", (d?.birthDate as string) ?? member.birthDate],
    ["老人分类", codeLabel(dicts.memberTypes, d?.memberType)],
    ["证件", d?.idNumber ? `${codeLabel(dicts.idTypes, d?.idType) ?? ""} ${d.idNumber}` : undefined],
    ["身高体重", [d?.height && `${d.height} cm`, d?.weight && `${d.weight} kg`].filter(Boolean).join(" · ") || undefined],
    ["地址", d?.address as string | undefined],
  ];

  return (
    <div className="detail mem-detail">
      <div className="detail-head">
        <div className="detail-title">
          <h1>{member.realName}</h1>
          <span className={`grade ${state === "in" ? "ok" : state === "lost" ? "bad" : ""}`}>{STATE_TEXT[state]}</span>
          <span className="grow" />
          <Button icon={<EditOutlined />} onClick={onEdit}>
            修改资料
          </Button>
        </div>
      </div>

      <div className="ops-grid">
        <div className="ops-card">
          <h2>资料</h2>
          {d ? (
            <dl className="kv">
              {kv.map(([k, v]) => (
                <span key={k} style={{ display: "contents" }}>
                  <dt>{k}</dt>
                  <dd>{v || <span className="muted">—</span>}</dd>
                </span>
              ))}
            </dl>
          ) : (
            <Spin />
          )}
        </div>

        <div className="ops-card">
          <h2>入住</h2>
          {state === "in" && bed ? (
            <>
              <div className="mem-bed">
                <b>
                  {bed.roomName} › {bed.bedName}
                </b>
                <span className="muted small">
                  {bed.building} › {bed.floor}
                  {member.checkInAt && ` · ${member.checkInAt.slice(0, 10)} 入住`}
                </span>
              </div>
              <Space wrap>
                <Button onClick={onAdjust}>调到空床</Button>
                <Button icon={<SwapOutlined />} onClick={onSwap}>
                  和别人对调
                </Button>
                <Button danger onClick={onCheckOut}>
                  退住
                </Button>
              </Space>
            </>
          ) : state === "lost" ? (
            <>
              <Alert type="warning" showIcon message="平台记着已入住，但哪张床上都没有他" description="通常是别人被调到了他的床上。先办退住，再重新入住。" style={{ marginBottom: 10 }} />
              <Button danger onClick={onCheckOut}>
                退住
              </Button>
            </>
          ) : (
            <>
              <p className="muted">{state === "out" ? "已退住，可以重新办理入住。" : "还没入住。"}</p>
              <Button type="primary" onClick={onCheckIn}>
                办理入住
              </Button>
            </>
          )}
        </div>

        <div className="ops-card">
          <h2>
            关联设备 <span className="muted">{devices?.length ?? ""}</span>
          </h2>
          <p className="muted small">办入住时平台会把房间里的设备自动关联给入住的人，退住时去掉；手动关联时一台设备只归属一位长者。和床位上绑的设备是两回事（床位设备在楼宇页管）。</p>
          {devices === undefined ? (
            <Spin />
          ) : (
            <ul className="space-radars">
              {devices.map((x) => (
                <li key={x.deviceId}>
                  <span className="grow">{x.deviceName || x.sn}</span>
                  <span className="mono muted">{x.sn}</span>
                  <Popconfirm title="取消关联这台设备？" okText="取消关联" okButtonProps={{ danger: true }} onConfirm={() => unbind(x)}>
                    <Button type="text" size="small" icon={<DeleteOutlined />} title="取消关联" />
                  </Popconfirm>
                </li>
              ))}
            </ul>
          )}
          <Select
            showSearch
            value={null}
            placeholder="关联一台设备（按名称或 SN 搜索）"
            style={{ width: "100%" }}
            loading={candLoading || busy === "bind"}
            disabled={busy === "bind"}
            onFocus={loadCands}
            onOpenChange={(o) => o && loadCands()}
            onChange={(v: string) => v && bind(v)}
            optionFilterProp="label"
            notFoundContent={candLoading ? <Spin size="small" /> : "没有可关联的设备"}
            options={(cands ?? [])
              .filter((x) => !devices?.some((y) => y.deviceId === x.deviceId))
              .map((x) => {
                const owner = x.owners?.find((o) => o.memberId !== member.id);
                return { value: x.deviceId, label: `${x.deviceName || x.sn} · ${x.sn}${owner ? `（现关联 ${owner.memberName}）` : ""}` };
              })}
          />
        </div>

        <div className="ops-card">
          <h2>
            亲友 <span className="muted">{relatives?.length ?? ""}</span>
          </h2>
          {relatives === undefined ? (
            <Spin />
          ) : relatives.length === 0 && !addingRel ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有亲友" style={{ margin: "4px 0 10px" }} />
          ) : (
            <ul className="space-radars">
              {relatives.map((r) => (
                <li key={r.memberId}>
                  <span className="grow">
                    {r.realName}
                    <span className="muted small"> · {codeLabel(dicts.relations, r.relationshipType) ?? "亲友"}</span>
                  </span>
                  <span className="mono muted">{r.phoneNumber}</span>
                  <Popconfirm title={`解除和"${r.realName}"的关系？`} description="亲友那条记录仍留在长者列表里" okText="解除" okButtonProps={{ danger: true }} onConfirm={() => dropRelative(r)}>
                    <Button type="text" size="small" icon={<DeleteOutlined />} title="解除关系" />
                  </Popconfirm>
                </li>
              ))}
            </ul>
          )}
          {addingRel ? (
            <div className="mem-rel-form">
              <Input placeholder="姓名" maxLength={32} value={rel.realName} onChange={(e) => setRel({ ...rel, realName: e.target.value })} autoFocus />
              <Input placeholder="手机号" maxLength={20} value={rel.phoneNumber} onChange={(e) => setRel({ ...rel, phoneNumber: e.target.value })} />
              <Select
                placeholder="关系"
                showSearch
                optionFilterProp="label"
                value={rel.relationshipType}
                onChange={(v) => setRel({ ...rel, relationshipType: v })}
                options={dicts.relations.map((c) => ({ value: Number(c.value), label: c.label }))}
              />
              <Space>
                <Button type="primary" size="small" loading={busy === "rel"} disabled={!rel.realName.trim() || !rel.relationshipType} onClick={saveRelative}>
                  添加
                </Button>
                <Button size="small" onClick={() => setAddingRel(false)}>
                  取消
                </Button>
              </Space>
              <span className="muted small">平台按手机号认人：手机号已登记过的会直接关联那个人；亲友也会出现在长者列表里</span>
            </div>
          ) : (
            <Button size="small" icon={<PlusOutlined />} onClick={() => setAddingRel(true)}>
              加亲友
            </Button>
          )}
        </div>
      </div>

      <div className="mem-danger">
        {state === "in" || state === "lost" ? (
          <span className="muted small">要删除这位长者，先办理退住（平台删除不会腾出床位）</span>
        ) : (
          <Button danger icon={<DeleteOutlined />} onClick={onDelete}>
            从本机构删除
          </Button>
        )}
      </div>
    </div>
  );
}
