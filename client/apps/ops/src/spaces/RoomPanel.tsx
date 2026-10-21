import { useEffect, useState } from "react";
import { Button, InputNumber, Popconfirm, Select, Space, Tooltip } from "antd";
import { CloseOutlined, DeleteOutlined, DisconnectOutlined, PlusOutlined } from "@ant-design/icons";
import type { Radar, RoomDevice } from "../api/device";
import type { Room } from "../api/room";
import type { BedRow } from "../api/space";
import EditableText from "./EditableText";

const occupied = (b: BedRow) => b.bedStatus === 2 || !!b.realName;

/** 楼宇页右侧的房间面板：改名、改尺寸、管床位（空床直接办入住、给床位绑本房间的设备），看绑了哪些雷达 */
export default function RoomPanel({
  room,
  place,
  beds,
  radars,
  roomDevices,
  onClose,
  onRename,
  onResize,
  onAddBed,
  onRenameBed,
  onDeleteBed,
  onCheckIn,
  onBindBedDevice,
  onUnbindBedDevice,
  onDelete,
}: {
  room: Room;
  place: string;
  beds: BedRow[];
  radars: Radar[];
  /** 房间里的设备和它们绑的床位（/api/room/radars），还没取到时为 undefined */
  roomDevices?: RoomDevice[];
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onResize: (width: number, long: number) => Promise<void>;
  onAddBed: () => Promise<void>;
  onRenameBed: (b: BedRow, name: string) => Promise<void>;
  onDeleteBed: (b: BedRow) => Promise<void>;
  onCheckIn: (b: BedRow) => void;
  onBindBedDevice: (b: BedRow, deviceId: string) => Promise<void>;
  onUnbindBedDevice: (b: BedRow, d: RoomDevice) => Promise<void>;
  onDelete: () => void;
}) {
  const [w, setW] = useState(room.roomWidth ?? 4);
  const [l, setL] = useState(room.roomLong ?? 4);
  const [busy, setBusy] = useState<string>();
  useEffect(() => {
    setW(room.roomWidth ?? 4);
    setL(room.roomLong ?? 4);
  }, [room.id, room.roomWidth, room.roomLong]);
  const sizeChanged = w !== (room.roomWidth ?? 4) || l !== (room.roomLong ?? 4);

  const wrap = (key: string, fn: () => Promise<void>) => async () => {
    setBusy(key);
    try {
      await fn();
    } catch {
      // 错误由调用方提示
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <aside className="space-panel">
      <div className="space-panel-head">
        <EditableText key={room.id} value={room.roomName} onSave={onRename} className="space-panel-title" />
        <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} title="关闭" />
      </div>
      <div className="muted small">{place}</div>

      <h3>尺寸</h3>
      <Space size={6} wrap>
        宽
        <InputNumber size="small" min={1} max={50} step={0.1} value={w} onChange={(v) => v !== null && setW(v)} style={{ width: 72 }} />
        长
        <InputNumber size="small" min={1} max={50} step={0.1} value={l} onChange={(v) => v !== null && setL(v)} style={{ width: 72 }} />
        <span className="muted small">米</span>
        {sizeChanged && (
          <Button size="small" type="primary" loading={busy === "size"} onClick={wrap("size", () => onResize(w, l))}>
            保存
          </Button>
        )}
      </Space>
      <div className="muted small space-hint">只改房间外框，里面的家具和区域位置不动</div>

      <h3>
        床位 <span className="muted">{beds.length}</span>
      </h3>
      <ul className="space-beds-list" data-spot="beds" data-room={room.id}>
        {beds.map((b) => {
          const onBed = roomDevices?.filter((d) => d.bedId === b.id) ?? [];
          const free = roomDevices?.filter((d) => !d.bedId) ?? [];
          return (
            <li key={b.id} className="space-bed-row">
              <div className="space-bed-line">
                <EditableText value={b.bedName} onSave={(v) => onRenameBed(b, v)} className="grow" />
                {occupied(b) ? (
                  <span className="space-who">{b.realName ?? "已入住"}</span>
                ) : (
                  <Button type="link" size="small" className="space-checkin" onClick={() => onCheckIn(b)}>
                    入住
                  </Button>
                )}
                {occupied(b) ? (
                  <Tooltip title="有人入住，先办理退住再删">
                    <Button type="text" size="small" icon={<DeleteOutlined />} disabled />
                  </Tooltip>
                ) : (
                  <Popconfirm
                    title={`删除床位"${b.bedName}"？`}
                    description={b.deviceCount ? `会解绑 ${b.deviceCount} 台设备` : undefined}
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => onDeleteBed(b)}
                  >
                    <Button type="text" size="small" icon={<DeleteOutlined />} title="删除床位" />
                  </Popconfirm>
                )}
              </div>
              <div className="space-bed-line small">
                {onBed.map((d) => (
                  <span key={d.deviceId} className="space-bed-dev">
                    {d.deviceName || d.sn}
                    <Popconfirm title={`从床位上解绑"${d.deviceName || d.sn}"？`} description="设备仍留在这个房间" okText="解绑" onConfirm={() => onUnbindBedDevice(b, d)}>
                      <DisconnectOutlined className="space-bed-x" title="从床位解绑" />
                    </Popconfirm>
                  </span>
                ))}
                {onBed.length === 0 &&
                  (roomDevices === undefined ? null : free.length ? (
                    <Select
                      size="small"
                      variant="borderless"
                      className="space-bed-pick"
                      placeholder="+ 绑床位设备"
                      value={null}
                      loading={busy === `dev-${b.id}`}
                      popupMatchSelectWidth={false}
                      onChange={(v: string) => v && wrap(`dev-${b.id}`, () => onBindBedDevice(b, v))()}
                      options={free.map((d) => ({ value: d.deviceId, label: `${d.deviceName || d.sn} · ${d.sn.slice(-6)}` }))}
                    />
                  ) : (
                    <span className="muted">没有床位设备</span>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
      <Button size="small" icon={<PlusOutlined />} loading={busy === "bed"} onClick={wrap("bed", onAddBed)}>
        加一张床
      </Button>

      <h3>
        雷达 <span className="muted">{radars.length}</span>
      </h3>
      {radars.length ? (
        <ul className="space-radars">
          {radars.map((d) => (
            <li key={d.id}>
              <i className={`dot ${d.isDisabled ? "disabled" : d.isOnline ? "online" : "offline"}`} />
              <span className="grow">{d.deviceName}</span>
              <span className="mono muted">{d.sn}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted small">还没绑雷达，到"设备"页给雷达选安装位置</div>
      )}

      <div className="grow" />
      <Button danger icon={<DeleteOutlined />} onClick={onDelete} className="space-panel-del">
        删除房间
      </Button>
    </aside>
  );
}
