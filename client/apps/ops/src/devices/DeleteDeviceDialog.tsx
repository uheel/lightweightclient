import { useEffect, useState } from "react";
import { Alert, App, Checkbox, Input, Modal, Spin } from "antd";
import type { Radar } from "../api/device";
import { planDelete, removeRadar, type DeletePlan } from "./deleteRadar";

/**
 * 删除设备：先列出会一起解除的房间、床位、长者绑定（平台删除时自动解除）和房间布置里的位置，再输入 SN 后 4 位确认。
 * 平台上删除不能恢复；同一个 SN 重新添加会是一台新设备，属性记录、场景记录要从设备读回或重新下发。
 */
export default function DeleteDeviceDialog({
  d,
  open,
  online,
  place,
  onClose,
  onDeleted,
}: {
  d: Radar;
  open: boolean;
  /** 按设备数据判断的在线状态 */
  online: boolean;
  /** 房间的完整位置（楼栋 / 楼层 / 房间），没有时用 roomName */
  place?: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { message } = App.useApp();
  const [plan, setPlan] = useState<DeletePlan>();
  const [keepSlot, setKeepSlot] = useState(true);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const tail = d.sn.slice(-4);

  useEffect(() => {
    if (!open) return;
    setPlan(undefined);
    setKeepSlot(true);
    setTyped("");
    let alive = true;
    planDelete(d).then((p) => alive && setPlan(p), () => alive && setPlan({ slot: false, members: d.realName ? [d.realName] : [] }));
    return () => {
      alive = false;
    };
  }, [open, d]);

  async function submit() {
    if (!plan) return;
    setBusy(true);
    try {
      const failed = await removeRadar(d, plan, { keepSlot });
      if (failed.length) message.warning({ content: `设备已删除，但${failed.join("；")}。可以到"诊断"页处理`, duration: 8 });
      else message.success(`已删除 ${d.deviceName || d.sn}`);
      onDeleted();
    } catch (e) {
      message.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const room = place || d.roomName;

  return (
    <Modal
      title={`删除设备"${d.deviceName || d.sn}"？`}
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="删除"
      okButtonProps={{ danger: true, disabled: !plan || typed.trim().toUpperCase() !== tail.toUpperCase() }}
      confirmLoading={busy}
      destroyOnHidden
      width={520}
    >
      {!plan ? (
        <Spin size="small" />
      ) : (
        <div className="dev-delete">
          {online && (
            <Alert
              type="warning"
              showIcon
              message="这台设备还在线"
              description='删除后它仍会继续上报，会出现在平台的"未入库设备"里。只是暂时不用的话，可以不删。'
            />
          )}
          {(room || plan.bed || plan.members.length > 0) && (
            <>
              <p>会一起解除：</p>
              <ul>
                {room && <li>房间绑定：{room}</li>}
                {plan.bed && <li>床位"{plan.bed.bedName ?? plan.bed.bedId}"上的绑定</li>}
                {plan.members.length > 0 && <li>关联的长者：{plan.members.join("、")}</li>}
              </ul>
            </>
          )}
          {plan.slot && (
            <Checkbox checked={keepSlot} onChange={(e) => setKeepSlot(e.target.checked)}>
              房间布置里留下这个雷达位置（只清掉设备，安装方式和区域留着，下次装新设备直接用）
            </Checkbox>
          )}
          <p className="muted">
            平台上删除后不能恢复。以后用同一个 SN 重新添加会是一台新设备，平台上的属性记录、场景记录不会带过去（设备本身的区域和场景还在，可以读回）。
          </p>
          <Input placeholder={`输入 SN 后 4 位"${tail}"确认删除`} value={typed} onChange={(e) => setTyped(e.target.value)} onPressEnter={() => !busy && typed.trim().toUpperCase() === tail.toUpperCase() && submit()} />
        </div>
      )}
    </Modal>
  );
}
