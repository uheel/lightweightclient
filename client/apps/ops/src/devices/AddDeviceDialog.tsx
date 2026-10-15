import { useEffect, useState } from "react";
import { App, Form, Input, Modal, Select, Space } from "antd";
import {
  createRadar,
  getBuildingOptions,
  getFloorOptions,
  getRadarTypes,
  getRoomOptions,
  type Option,
  type Radar,
} from "../api/device";

interface Values {
  sn: string;
  deviceName: string;
  deviceType: number;
  buildingId?: string;
  floorId?: string;
  roomId?: string;
  description?: string;
}

/** 添加雷达设备（字段同平台雷达设备页的"新增"） */
export default function AddDeviceDialog({ open, existing, onClose, onCreated }: {
  open: boolean;
  /** 本机构已有的设备，用来提示 SN 重复 */
  existing: Radar[];
  onClose: () => void;
  onCreated: (sn: string) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [types, setTypes] = useState<{ value: number; label: string }[]>([]);
  const [buildings, setBuildings] = useState<Option[]>([]);
  const [floors, setFloors] = useState<Option[]>([]);
  const [rooms, setRooms] = useState<Option[]>([]);
  const [saving, setSaving] = useState(false);
  const buildingId = Form.useWatch("buildingId", form);
  const floorId = Form.useWatch("floorId", form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    getRadarTypes().then(setTypes, () => {});
    getBuildingOptions().then(setBuildings, () => {});
  }, [open, form]);

  useEffect(() => {
    setFloors([]);
    if (buildingId) getFloorOptions(buildingId).then(setFloors, () => {});
  }, [buildingId]);
  useEffect(() => {
    setRooms([]);
    if (floorId) getRoomOptions(floorId).then(setRooms, () => {});
  }, [floorId]);

  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const sn = v.sn.trim();
      await createRadar({ ...v, sn, deviceName: v.deviceName.trim(), description: v.description?.trim() || undefined });
      message.success(`已添加设备 ${v.deviceName.trim()}`);
      onCreated(sn);
    } catch (e) {
      message.error(`添加失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="添加设备"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="添加"
      confirmLoading={saving}
      destroyOnHidden
      width={560}
    >
      <Form form={form} layout="vertical" requiredMark="optional" style={{ marginTop: 16 }}>
        <Form.Item
          name="sn"
          label="序列号（SN）"
          extra="全平台唯一"
          rules={[
            { required: true, whitespace: true, message: "请输入序列号" },
            {
              validator: (_, val?: string) => {
                const hit = val && existing.find((d) => d.sn.toLowerCase() === val.trim().toLowerCase());
                return hit ? Promise.reject(new Error(`本机构已有这台设备：${hit.deviceName || hit.sn}`)) : Promise.resolve();
              },
            },
          ]}
        >
          <Input className="mono" maxLength={64} placeholder="请输入" allowClear />
        </Form.Item>
        <Form.Item name="deviceName" label="设备名称" rules={[{ required: true, whitespace: true, message: "请输入设备名称" }]}>
          <Input maxLength={32} placeholder="例如 101 房间" />
        </Form.Item>
        <Form.Item name="deviceType" label="设备类型" rules={[{ required: true, message: "请选择设备类型" }]}>
          <Select options={types} placeholder="请选择" showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item label="安装位置" extra="可以先不填，之后再绑定房间">
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
        <Form.Item name="description" label="备注">
          <Input.TextArea maxLength={200} autoSize={{ minRows: 2, maxRows: 4 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
