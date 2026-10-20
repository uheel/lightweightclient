import { useEffect, useState } from "react";
import { App, Button, Input, Tooltip } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { renameRadar, type Radar } from "../api/device";
import { syncSlotName } from "../rooms/radarSlot";

/** 平台限制设备名最长 32 个字 */
const MAX = 32;

/** 设备详情标题：点铅笔就地改名，回车保存、Esc 取消 */
export default function NameEdit({ d, onRenamed }: { d: Radar; onRenamed?: () => void }) {
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  // 换了设备就退出编辑
  useEffect(() => setEditing(false), [d.id]);

  async function save() {
    const name = value.trim();
    if (!name) return message.warning("设备名不能为空");
    if (name === d.deviceName) return setEditing(false);
    setSaving(true);
    try {
      await renameRadar(d.id, name, d.roomId);
      // 房间布置里存的设备名一起改；这一步失败不影响改名本身
      let slot = "";
      if (d.roomId)
        await syncSlotName(d.roomId, d.sn, name).catch((e) => {
          slot = `，但房间布置里的名字没同步：${e instanceof Error ? e.message : String(e)}`;
        });
      if (slot) message.warning(`已改名${slot}`);
      else message.success("已改名");
      setEditing(false);
      onRenamed?.();
    } catch (e) {
      message.error(`改名失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (editing)
    return (
      <Input
        className="name-edit"
        autoFocus
        value={value}
        maxLength={MAX}
        showCount
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onPressEnter={save}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        suffix={
          <Button type="link" size="small" loading={saving} onClick={save}>
            保存
          </Button>
        }
      />
    );

  return (
    <span className="name-view">
      <h1>{d.deviceName || d.sn}</h1>
      <Tooltip title="改名">
        <Button
          type="text"
          size="small"
          className="name-edit-btn"
          aria-label="改名"
          icon={<EditOutlined />}
          onClick={() => {
            setValue(d.deviceName || "");
            setEditing(true);
          }}
        />
      </Tooltip>
    </span>
  );
}
