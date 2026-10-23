import { useEffect, useState } from "react";
import { Alert, App, Checkbox, Input, Modal, Spin } from "antd";
import { api } from "@radar/core";
import { deleteRadar } from "../api/device";
import { disableMasterSip, getMasterRoomKeys } from "../api/master";
import type { DevRow } from "./category";

/**
 * 删除雷达以外的设备（管理主机、外设、手表、戒指…），和雷达一样走 DELETE /api/device/v3?id=，输入 SN 后 4 位确认。
 * 先按类型列出删了会怎样：主机的覆盖房间和通讯录、SIP 账号；外设挂在哪台雷达上；手表戒指关联的长者
 */

interface Plan {
  /** 管理主机：覆盖的房间数、通讯录里的雷达数 */
  rooms?: number;
  /** 蓝牙外设挂在哪台雷达上（雷达的 slave_config 里还会留着它） */
  radar?: string;
  members: string[];
}

async function planFor(d: DevRow): Promise<Plan> {
  const members = () =>
    api
      .get<{ realName?: string }[]>("/api/device-position/v2/device-members", { params: { deviceId: d.id } })
      .then((r) => (r.data ?? []).map((m) => m.realName ?? "").filter(Boolean))
      .catch(() => [] as string[]);
  if (d.cat === "master") {
    const rooms = await getMasterRoomKeys(d).then((k) => k.length).catch(() => undefined);
    return { rooms, members: [] };
  }
  if (d.cat === "slave") {
    const list = await api
      .get<{ id: string; radarDeviceName?: string }[]>("/api/device/v3/bluetooth-slave-pages", { params: { current: 1, pageSize: 5000 } })
      .then((r) => r.data ?? [])
      .catch(() => []);
    return { radar: list.find((x) => x.id === d.id)?.radarDeviceName, members: await members() };
  }
  return { members: await members() };
}

export default function DeleteOtherDialog({ d, open, onClose, onDeleted }: { d: DevRow; open: boolean; onClose: () => void; onDeleted: () => void }) {
  const { message } = App.useApp();
  const [plan, setPlan] = useState<Plan>();
  const [releaseSip, setReleaseSip] = useState(true);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const tail = d.sn.slice(-4);
  const m = d.master;
  const sipOn = d.cat === "master" && !!m?.sipEnable;

  useEffect(() => {
    if (!open) return;
    setPlan(undefined);
    setReleaseSip(true);
    setTyped("");
    let alive = true;
    planFor(d).then(
      (p) => alive && setPlan(p),
      () => alive && setPlan({ members: [] }),
    );
    return () => {
      alive = false;
    };
  }, [open, d]);

  const ok = !!plan && typed.trim().toUpperCase() === tail.toUpperCase();

  async function submit() {
    if (!ok) return;
    setBusy(true);
    try {
      let note = "";
      // 先停用 SIP，账号回到平台的账号池；停用失败不拦着删除
      if (sipOn && releaseSip)
        await disableMasterSip(d).catch((e) => {
          note = `，但停用 SIP 失败（${e instanceof Error ? e.message : String(e)}），账号 ${m?.sipUserName ?? ""} 可能还占着`;
        });
      await deleteRadar(d.id);
      if (note) message.warning({ content: `已删除 ${d.deviceName || d.sn}${note}`, duration: 8 });
      else message.success(`已删除 ${d.deviceName || d.sn}`);
      onDeleted();
    } catch (e) {
      message.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const items: string[] = [];
  if (plan?.rooms) items.push(`覆盖的 ${plan.rooms} 个房间`);
  if (d.cat === "master" && m?.deviceCount) items.push(`通讯录里的 ${m.deviceCount} 台雷达（主机上就看不到、也呼不了它们了）`);
  if (plan?.members.length) items.push(`关联的长者：${plan.members.join("、")}`);

  return (
    <Modal
      title={`删除${d.cat === "master" ? "管理主机" : "设备"}"${d.deviceName || d.sn}"？`}
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="删除"
      okButtonProps={{ danger: true, disabled: !ok }}
      confirmLoading={busy}
      destroyOnHidden
      width={520}
    >
      {!plan ? (
        <Spin size="small" />
      ) : (
        <div className="dev-delete">
          {d.isOnline && (
            <Alert
              type="warning"
              showIcon
              message="这台设备还在线"
              description='删除后它仍会继续连平台，会出现在平台的"未入库设备"里。只是暂时不用的话，可以不删。'
            />
          )}
          {items.length > 0 && (
            <>
              <p>会一起解除：</p>
              <ul>
                {items.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
          {sipOn && (
            <Checkbox checked={releaseSip} onChange={(e) => setReleaseSip(e.target.checked)}>
              先停用 SIP，把账号 {m?.sipUserName} 还给平台的账号池
            </Checkbox>
          )}
          {d.cat === "master" && m?.sipUserName && (
            <p className="muted small">紧急号码或备用号码填了这台主机 SIP 号（{m.sipUserName}）的雷达，删除后告警就打不通了，要到雷达的通话页改掉。</p>
          )}
          {plan.radar && (
            <p className="muted small">
              它挂在雷达"{plan.radar}"上。删除后那台雷达的外设列表里还留着它，到雷达的"设备属性 › 雷达外设"里一起删掉。
            </p>
          )}
          <p className="muted">平台上删除后不能恢复。以后用同一个 SN 重新添加会是一台新设备，原来的配置记录不会带过去。</p>
          <Input
            placeholder={`输入 SN 后 4 位"${tail}"确认删除`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onPressEnter={() => !busy && ok && submit()}
          />
        </div>
      )}
    </Modal>
  );
}
