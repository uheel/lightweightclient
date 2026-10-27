import { useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Form, Input, Modal, Radio, Select, Space } from "antd";
import {
  CAREGIVER_WATCH_TYPE,
  createCaregiverWatch,
  createRadar,
  createSlave,
  getFreeSip,
  getBuildingOptions,
  getFloorOptions,
  getRadars,
  getRadarTypes,
  getRoomOptions,
  getSlaveTypes,
  type Option,
  type Radar,
} from "../api/device";
import { createMaster, MASTER_TYPE } from "../api/master";
import { placeInLayout, SLOT_TEXT, slotSource, type SlotSource } from "../rooms/radarSlot";
import { SlotAreaLine } from "../rooms/AreaSelect";
import TypeCascader, { type TypeGroup } from "./TypeCascader";
import WatchSetupQr from "./WatchSetupQr";
import type { InstallArea } from "../rooms/installArea";

interface Values {
  sn: string;
  deviceName: string;
  deviceType: number;
  buildingId?: string;
  floorId?: string;
  roomId?: string;
  description?: string;
  /** 护工手表：0 局域网，1 云对讲 */
  callType?: 0 | 1;
  netLocalIp?: string;
  mac?: string;
}

/** 护工手表云对讲用的 SIP 账号（平台账号池里取的，保存时才占用） */
type Sip = { sipAccount?: string; sipPassword?: string; sipServer?: string };

/**
 * 添加设备：雷达（字段同平台雷达设备页的"新增"）、管理主机（同平台管理主机页的"新增"：只有名称和序列号）、
 * 护工手表（同平台护工手表管理的"新增"）或蓝牙外设（同平台"蓝牙外设"的"新增"；绑到哪台雷达在雷达的设备属性 › 雷达外设里选）
 */
export default function AddDeviceDialog({ open, existing, defaultType, onClose, onCreated }: {
  open: boolean;
  /** 打开时默认选中的设备类型（例如列表正按管理主机筛选时） */
  defaultType?: number;
  /** 本机构已有的设备，用来提示 SN 重复 */
  existing: Radar[];
  onClose: () => void;
  onCreated: (sn: string) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [radarTypes, setRadarTypes] = useState<{ value: number; label: string }[]>([]);
  const [slaveTypes, setSlaveTypes] = useState<{ value: number; label: string }[]>([]);
  const [buildings, setBuildings] = useState<Option[]>([]);
  const [floors, setFloors] = useState<Option[]>([]);
  const [rooms, setRooms] = useState<Option[]>([]);
  const [saving, setSaving] = useState(false);
  const buildingId = Form.useWatch("buildingId", form);
  const floorId = Form.useWatch("floorId", form);
  const roomId = Form.useWatch("roomId", form);
  const deviceType = Form.useWatch("deviceType", form);
  /** 选了房间时，布置里放哪（平台新增设备只绑房间，不动布置） */
  const [slot, setSlot] = useState<SlotSource>();
  const [place, setPlace] = useState(true);
  /** 放进布置时这台雷达的安装区域（默认沿用位置上原有的） */
  const [area, setArea] = useState<InstallArea | null>(null);
  /** 新建空白位置时的装法：1 侧装，0 顶装 */
  const [mount, setMount] = useState<0 | 1>(1);
  const callType = Form.useWatch("callType", form);
  const [watchQr, setWatchQr] = useState(false);
  const [sip, setSip] = useState<Sip>();
  const [sipLoading, setSipLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (defaultType !== undefined) form.setFieldsValue({ deviceType: defaultType });
    setMount(1);
    setSip(undefined);
    getRadarTypes().then(setRadarTypes, () => setRadarTypes([]));
    getSlaveTypes().then(setSlaveTypes, () => setSlaveTypes([]));
    getBuildingOptions().then(setBuildings, () => {});
  }, [open, form, defaultType]);

  useEffect(() => {
    setFloors([]);
    if (buildingId) getFloorOptions(buildingId).then(setFloors, () => {});
  }, [buildingId]);
  useEffect(() => {
    setRooms([]);
    if (floorId) getRoomOptions(floorId).then(setRooms, () => {});
  }, [floorId]);

  /** 设备类型分栏：大类 → 型号。雷达、蓝牙外设型号来自平台字典，管理主机、护工手表目前各一个型号 */
  const groups = useMemo<TypeGroup[]>(
    () => [
      { value: "radar", label: "毫米波雷达", types: radarTypes },
      { value: "master", label: "管理主机", types: [{ value: MASTER_TYPE, label: "管理主机" }] },
      { value: "watch", label: "手表", types: [{ value: CAREGIVER_WATCH_TYPE, label: "护工手表" }] },
      { value: "slave", label: "蓝牙外设", types: slaveTypes },
    ],
    [radarTypes, slaveTypes],
  );

  const isMaster = deviceType === MASTER_TYPE;
  const isWatch = deviceType === CAREGIVER_WATCH_TYPE;
  const isSlave = slaveTypes.some((t) => t.value === deviceType);
  /** 不装在房间里的设备（蓝牙外设跟着它绑的雷达走） */
  const noRoom = isMaster || isWatch || isSlave;

  async function pickSip() {
    setSipLoading(true);
    try {
      const s = await getFreeSip();
      if (!s.sipAccount) throw new Error("平台账号池里没有空闲的 SIP 账号");
      setSip(s);
    } catch (e) {
      message.error(`取 SIP 账号失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSipLoading(false);
    }
  }

  // 护工手表选云对讲时自动取一个 SIP 账号
  useEffect(() => {
    if (isWatch && callType === 1 && !sip) pickSip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWatch, callType]);

  useEffect(() => {
    setSlot(undefined);
    if (!roomId || noRoom) return;
    let alive = true;
    slotSource({ sn: "", deviceType } as Radar, roomId).then(
      (x) => {
        if (!alive) return;
        setSlot(x);
        setArea(x.area ?? null);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [roomId, deviceType, noRoom]);

  async function submit() {
    const v = await form.validateFields();
    if (v.deviceType === CAREGIVER_WATCH_TYPE && v.callType === 1 && !sip?.sipAccount) {
      message.warning("云对讲要先取到一个 SIP 账号");
      return;
    }
    setSaving(true);
    try {
      const sn = v.sn.trim();
      const deviceName = v.deviceName.trim();
      if (v.deviceType === MASTER_TYPE) {
        // 管理主机不装在房间里；它管哪些房间在主机详情的"覆盖房间"里勾
        await createMaster({ sn, deviceName, description: v.description?.trim() || undefined });
        message.success(`已添加管理主机 ${deviceName}，接着在它的"覆盖房间"里勾上要管的房间`);
        onCreated(sn);
        return;
      }
      if (slaveTypes.some((t) => t.value === v.deviceType)) {
        await createSlave({ sn, deviceName, deviceType: v.deviceType, description: v.description?.trim() || undefined });
        message.success(`已添加蓝牙外设 ${deviceName}，到雷达的"设备属性 › 雷达外设"里把它绑到雷达上`);
        onCreated(sn);
        return;
      }
      if (v.deviceType === CAREGIVER_WATCH_TYPE) {
        const cloud = v.callType === 1;
        await createCaregiverWatch({
          deviceName,
          imei: sn,
          callType: cloud ? 1 : 0,
          netLocalIp: cloud ? undefined : v.netLocalIp?.trim(),
          sipAccount: cloud ? sip?.sipAccount : undefined,
          sipPassword: cloud ? sip?.sipPassword : undefined,
          mac: v.mac?.trim() || undefined,
          description: v.description?.trim() || undefined,
        });
        message.success(`已添加护工手表 ${deviceName}${cloud ? `，SIP 号码 ${sip?.sipAccount}` : ""}。在手表上扫配置码（设备列表选"手表"后右上角）连上平台`);
        onCreated(sn);
        return;
      }
      const id = await createRadar({ ...v, sn, deviceName, description: v.description?.trim() || undefined });
      let note = "";
      if (v.roomId && place && slot && slot.kind !== "has") {
        try {
          // 新增接口应返回设备 id；没返回时按 SN 查一下（布置里的雷达要带 deviceId）
          const devId = typeof id === "string" && id ? id : (await getRadars()).find((x) => x.sn === sn)?.id;
          await placeInLayout({ id: devId ?? "", sn, deviceName, deviceType: v.deviceType } as Radar, v.roomId, slot, area, mount);
        } catch (e) {
          note = `，但放进房间布置失败（${e instanceof Error ? e.message : String(e)}），可到"诊断"页补上`;
        }
      }
      if (note) message.warning(`已添加设备 ${deviceName}${note}`);
      else message.success(`已添加设备 ${deviceName}`);
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
      <Form form={form} layout="vertical" requiredMark style={{ marginTop: 16 }}>
        <Form.Item name="deviceType" label="设备类型" rules={[{ required: true, message: "请选择设备型号" }]}>
          <TypeCascader groups={groups} />
        </Form.Item>
        <Form.Item
          name="sn"
          label={isWatch ? "序列号 / IMEI" : isSlave ? "外设 ID" : "序列号（SN）"}
          extra={isSlave ? "外设上标的 ID，例如 FHKS_00019939848；全平台唯一" : "全平台唯一"}
          rules={[
            { required: true, whitespace: true, message: isSlave ? "请输入外设 ID" : "请输入序列号" },
            // 平台限制：蓝牙外设 ID 最多 32 个字符
            ...(isSlave ? [{ max: 32, message: "最多 32 个字符" }] : []),
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
        <Form.Item
          name="deviceName"
          label="设备名称"
          rules={[
            { required: true, whitespace: true, message: "请输入设备名称" },
            // 平台限制：雷达 32 个字，管理主机 64 个字
            { max: noRoom ? 64 : 32, message: `最多 ${noRoom ? 64 : 32} 个字` },
          ]}
        >
          <Input maxLength={noRoom ? 64 : 32} placeholder={isMaster ? "例如 1 楼护士站" : isWatch ? "例如 2 楼护工 1 号" : isSlave ? "例如 201 床头拉绳" : "例如 101 房间"} />
        </Form.Item>
        {isWatch ? (
          <>
            <Form.Item name="callType" label="通话方式" initialValue={0}>
              <Radio.Group
                optionType="button"
                options={[
                  { value: 0, label: "局域网" },
                  { value: 1, label: "云对讲" },
                ]}
              />
            </Form.Item>
            {callType === 1 ? (
              <Form.Item label="SIP 账号" extra="从平台账号池里随机取一个，添加后这个号码就归这块手表">
                <Space>
                  <span className="mono">{sip?.sipAccount ?? (sipLoading ? "正在取…" : "—")}</span>
                  {sip?.sipServer && <span className="muted small">{sip.sipServer}</span>}
                  <Button size="small" loading={sipLoading} onClick={pickSip}>
                    换一个
                  </Button>
                </Space>
              </Form.Item>
            ) : (
              <Form.Item
                name="netLocalIp"
                label="手表 IP 地址"
                extra="手表在局域网里的 IP，主机和雷达按这个地址呼它"
                rules={[
                  { required: true, whitespace: true, message: "请输入手表的 IP 地址" },
                  { pattern: /^\s*(\d{1,3}\.){3}\d{1,3}\s*$/, message: "格式像 192.168.1.20" },
                ]}
              >
                <Input className="mono" maxLength={64} placeholder="例如 192.168.1.20" />
              </Form.Item>
            )}
            <Form.Item name="mac" label="蓝牙 MAC" extra="可以不填">
              <Input className="mono" maxLength={64} placeholder="例如 AA:BB:CC:DD:EE:FF" />
            </Form.Item>
            <p className="muted small" style={{ marginTop: -8 }}>
              护工手表不装在房间里，也不绑长者。添加后在手表上扫
              <Button type="link" size="small" style={{ padding: "0 2px", height: "auto" }} onClick={() => setWatchQr(true)}>
                配置码
              </Button>
              连上平台，护工再用自己的编号登录。
            </p>
            <WatchSetupQr open={watchQr} onClose={() => setWatchQr(false)} />
          </>
        ) : isSlave ? (
          <p className="muted small" style={{ marginTop: -8 }}>
            蓝牙外设不装在房间里。添加后到要绑的雷达的"设备属性 › 雷达外设"里选它，下发后外设就连到这台雷达。
          </p>
        ) : isMaster ? (
          <p className="muted small" style={{ marginTop: -8 }}>
            管理主机不装在房间里。添加后在它的"覆盖房间"里勾上要管的房间，主机上才有这些房间的雷达；云对讲还要给主机启用 SIP 账号。
          </p>
        ) : (
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
        )}
        {!noRoom && roomId && slot && slot.kind !== "has" && (
          <Form.Item style={{ marginTop: -12 }}>
            <Checkbox checked={place} onChange={(e) => setPlace(e.target.checked)}>
              {slot.kind === "roomType" && slot.typeName ? `从户型"${slot.typeName}"拷一个雷达位置（沿用户型里的安装方式和区域）` : SLOT_TEXT[slot.kind]}
            </Checkbox>
            {place && <SlotAreaLine slot={slot} area={area} onChange={setArea} mount={mount} onMount={setMount} />}
          </Form.Item>
        )}
        <Form.Item name="description" label="备注">
          <Input.TextArea maxLength={200} autoSize={{ minRows: 2, maxRows: 4 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

