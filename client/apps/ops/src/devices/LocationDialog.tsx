import { useEffect, useState } from "react";
import { Alert, App, Checkbox, Form, Modal, Select, Space, Spin } from "antd";
import { getBuildingOptions, getFloorOptions, getRoomOptions, type Option, type Radar } from "../api/device";
import { getRooms } from "../api/room";
import { moveRadar, planMove, type MovePlan } from "../rooms/moveRadar";
import { SLOT_TEXT } from "../rooms/radarSlot";
import { SlotAreaLine } from "../rooms/AreaSelect";
import type { InstallArea } from "../rooms/installArea";

interface Values {
  buildingId?: string;
  floorId?: string;
  roomId?: string;
}

/**
 * 更改安装位置（绑定的房间）。不选房间 = 解除绑定。
 * 原房间的床位、布置和新房间的空雷达位置一起处理，处理哪些由用户勾选（默认都处理），见 rooms/moveRadar.ts。
 */
export default function LocationDialog({ d, open, onClose, onMoved }: { d: Radar; open: boolean; onClose: () => void; onMoved: () => void }) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [buildings, setBuildings] = useState<Option[]>([]);
  const [floors, setFloors] = useState<Option[]>([]);
  const [rooms, setRooms] = useState<Option[]>([]);
  const [ready, setReady] = useState(false);
  const [plan, setPlan] = useState<MovePlan>();
  const [planning, setPlanning] = useState(false);
  const [opts, setOpts] = useState({ unbindBed: true, keepOldSlot: true, placeNew: true });
  const [area, setArea] = useState<InstallArea | null>(null);
  const [saving, setSaving] = useState(false);
  const buildingId = Form.useWatch("buildingId", form);
  const floorId = Form.useWatch("floorId", form);
  const roomId = Form.useWatch("roomId", form);

  // 打开时按当前绑定的房间填好楼栋、楼层
  useEffect(() => {
    if (!open) return;
    setReady(false);
    form.resetFields();
    setOpts({ unbindBed: true, keepOldSlot: true, placeNew: true });
    getBuildingOptions().then(setBuildings, () => {});
    (d.roomId ? getRooms().then((list) => list.find((r) => r.id === d.roomId)) : Promise.resolve(undefined))
      .then((r) => r && form.setFieldsValue({ buildingId: r.buildingId, floorId: r.floorId, roomId: r.id }), () => {})
      .finally(() => setReady(true));
  }, [open, d.roomId, form]);

  useEffect(() => {
    setFloors([]);
    if (buildingId) getFloorOptions(buildingId).then(setFloors, () => {});
  }, [buildingId]);
  useEffect(() => {
    setRooms([]);
    if (floorId) getRoomOptions(floorId).then(setRooms, () => {});
  }, [floorId]);

  // 选了房间就算一下要连带处理什么
  const target = roomId || undefined;
  const changed = ready && target !== (d.roomId || undefined);
  useEffect(() => {
    setPlan(undefined);
    if (!open || !changed) return;
    let alive = true;
    setPlanning(true);
    planMove(d, target)
      .then(
        (p) => {
          if (!alive) return;
          setPlan(p);
          setArea(p.newSlot?.area ?? null);
        },
        () => {},
      )
      .finally(() => alive && setPlanning(false));
    // 没算完就关掉或改选：这次的结果作废，但 planning 要复位，否则再打开会一直转圈
    return () => {
      alive = false;
      setPlanning(false);
    };
  }, [open, changed, target, d]);

  const roomLabel = rooms.find((r) => r.value === target)?.label;

  async function submit() {
    if (!changed || !plan) return onClose();
    const v = form.getFieldsValue();
    const doIt = async () => {
      setSaving(true);
      try {
        const failed = await moveRadar(d, target ? { buildingId: v.buildingId, floorId: v.floorId, roomId: target } : null, plan, { ...opts, area });
        if (failed.length) message.warning({ content: `位置已改，但${failed.join("；")}。可以到"诊断"页处理`, duration: 8 });
        else message.success(target ? `已改到 ${roomLabel ?? "新房间"}` : "已解除房间绑定");
        onMoved();
      } catch (e) {
        message.error(`修改失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setSaving(false);
      }
    };
    if (d.roomId && plan.oldSlot && !opts.keepOldSlot)
      modal.confirm({
        title: "连雷达位置一起从原房间布置里删掉？",
        content: "原房间的安装方式和区域会一起删掉，以后再给这个房间装雷达，要重新配或从户型拷。",
        okText: "删掉并更改",
        onOk: doIt,
      });
    else await doIt();
  }

  const set = (k: keyof typeof opts) => (e: { target: { checked: boolean } }) => setOpts((o) => ({ ...o, [k]: e.target.checked }));

  return (
    <Modal
      title="更改安装位置"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText={changed && !target ? "解除绑定" : "保存"}
      okButtonProps={{ disabled: !changed || planning || !plan }}
      confirmLoading={saving}
      destroyOnHidden
      width={560}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item label="安装位置" extra="清空房间 = 解除绑定">
          <Space.Compact block>
            <Form.Item name="buildingId" noStyle>
              <Select
                allowClear
                placeholder="楼栋"
                options={buildings}
                style={{ width: "34%" }}
                onChange={() => form.setFieldsValue({ floorId: undefined, roomId: undefined })}
              />
            </Form.Item>
            <Form.Item name="floorId" noStyle>
              <Select
                allowClear
                placeholder="楼层"
                options={floors}
                disabled={!buildingId}
                style={{ width: "28%" }}
                onChange={() => form.setFieldsValue({ roomId: undefined })}
              />
            </Form.Item>
            <Form.Item name="roomId" noStyle>
              <Select allowClear showSearch optionFilterProp="label" placeholder="房间" options={rooms} disabled={!floorId} style={{ width: "38%" }} />
            </Form.Item>
          </Space.Compact>
        </Form.Item>
      </Form>

      {planning && <Spin size="small" />}
      {plan && (
        <div className="move-plan">
          {plan.bed && (
            <Checkbox checked={opts.unbindBed} onChange={set("unbindBed")}>
              解除原房间床位"{plan.bed.bedName ?? plan.bed.bedId}"上的绑定
            </Checkbox>
          )}
          {plan.oldSlot && (
            <Checkbox checked={opts.keepOldSlot} onChange={set("keepOldSlot")}>
              原房间布置里留下这个雷达位置（只清掉设备，安装方式和区域留着，下次装新设备直接用）
            </Checkbox>
          )}
          {plan.newSlot && plan.newSlot.kind !== "has" && (
            <Checkbox checked={opts.placeNew} onChange={set("placeNew")}>
              {plan.newSlot.kind === "roomType" && plan.newSlot.typeName
                ? `从户型"${plan.newSlot.typeName}"拷一个雷达位置（沿用户型里的安装方式和区域）`
                : SLOT_TEXT[plan.newSlot.kind]}
            </Checkbox>
          )}
          {target && plan.newSlot && plan.newSlot.kind !== "has" && opts.placeNew && <SlotAreaLine slot={plan.newSlot} area={area} onChange={setArea} />}
          {target && plan.newSlot && plan.newSlot.kind !== "has" && !opts.placeNew && (
            <Alert type="info" showIcon message="新房间布置里不会有这台雷达，诊断页会提示区域没配" />
          )}
          {target && plan.newSlot && plan.newSlot.kind !== "has" && plan.newSlot.kind !== "placeholder" && opts.placeNew && (
            <Alert type="info" showIcon message={plan.newSlot.kind === "roomType" ? '改完后到"设备属性 › 安装区域"点"按房间布置下发"，户型里的区域就会发到设备上' : '改完后到"设备属性 › 安装区域"画区域，再下发到设备'} />
          )}
          {(d.realName || !!d.memberCount) && (
            <Alert type="info" showIcon message={`绑定的长者${d.realName ? ` ${d.realName}` : ""}不变，需要换人到"长者"页处理`} />
          )}
        </div>
      )}
    </Modal>
  );
}
