import { useEffect, useState } from "react";
import { App, Modal, Spin } from "antd";
import { getRoomDesign, radarElements, roomSize, saveRoomDesign, type PlanElement, type Room, type RoomDesign } from "../../api/room";
import FurnitureEditor, { mergeFurniture } from "./FurnitureEditor";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 换底图：src 是图片地址，没有就是去掉底图（外框恢复成平台默认的白底方框） */
export type BackdropChange = { src?: string };

/** 保存装修：重新取最新布置，只换家具（和改过的底图），雷达和区域原样保留；不下发设备。返回保存后的布置 */
export async function saveFurniture(roomId: string, items: PlanElement[], backdrop?: BackdropChange) {
  const fresh = await getRoomDesign(roomId);
  const cur = fresh?.roomStyle;
  const roomStyle = !backdrop ? cur : backdrop.src ? { ...cur, type: 4, src: backdrop.src } : { ...cur, type: 2, src: undefined, fill: "#fff", stroke: "#ccc", strokeWidth: 2 };
  await saveRoomDesign(roomId, { roomStyle, elements: mergeFurniture(fresh, items) });
  return getRoomDesign(roomId);
}

/**
 * 装修弹窗（房间布置页和楼宇页的房间面板共用）。
 * 传了 design 就直接用，没传时打开后自己取一次；保存成功后 onSaved 带回最新布置
 */
export default function DecorDialog({ room, design: given, onClose, onSaved }: { room: Room; design?: RoomDesign; onClose: () => void; onSaved?: (d: RoomDesign) => void }) {
  const { message, modal } = App.useApp();
  const [design, setDesign] = useState<RoomDesign | undefined>(given);
  const [error, setError] = useState<string>();
  const [edit, setEdit] = useState<{ items: PlanElement[]; dirty: boolean; backdrop?: BackdropChange }>({ items: [], dirty: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (given) return;
    getRoomDesign(room.id).then(setDesign, (e) => setError(`房间布置读不到：${errText(e)}`));
  }, [room.id, given]);

  const close = () =>
    edit.dirty ? modal.confirm({ title: "放弃没保存的装修？", okText: "放弃", okButtonProps: { danger: true }, cancelText: "继续编辑", onOk: onClose }) : onClose();

  return (
    <Modal
      open
      title={`装修 · ${room.roomName}`}
      width="min(1360px, 96vw)"
      centered
      okText="保存"
      okButtonProps={{ disabled: !edit.dirty }}
      confirmLoading={saving}
      maskClosable={false}
      onCancel={close}
      onOk={async () => {
        setSaving(true);
        try {
          const saved = await saveFurniture(room.id, edit.items, edit.backdrop);
          message.success(`装修已保存（${edit.items.length} 件家具），平台网页端也能看到`);
          onSaved?.(saved);
          onClose();
        } catch (e) {
          message.error(`保存装修失败：${errText(e)}`);
        } finally {
          setSaving(false);
        }
      }}
    >
      {design ? (
        <FurnitureEditor
          design={design}
          size={roomSize(design, room)}
          radars={radarElements(design).flatMap((e) => (e.qingLanConfig ? [e.qingLanConfig] : []))}
          saving={saving}
          onChange={(items, dirty, backdrop) => setEdit({ items, dirty, backdrop })}
        />
      ) : error ? (
        <div className="err-text">{error}</div>
      ) : (
        <Spin style={{ display: "block", margin: 80 }} />
      )}
    </Modal>
  );
}
