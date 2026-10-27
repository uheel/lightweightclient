import { useMemo, useState } from "react";
import { Alert, App, Button, Empty, QRCode, Select, Tag } from "antd";
import { CloseOutlined, DeleteOutlined, EditOutlined, HolderOutlined, PhoneOutlined, PlusOutlined } from "@ant-design/icons";
import { caregiverTypeName, type Caregiver, type CaregiverGroup, type GroupMembers } from "../api/caregiver";
import { deviceLabel, groupByFloor, type DeviceSpot } from "./model";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const GENDER: Record<number, string> = { 1: "男", 2: "女" };

/** 按楼层 › 房间列设备。onRemove 有值时每台设备带移出按钮，tag 给每台设备加个标注（例如来自哪个组） */
function DeviceRooms({ spots, onRemove, tag }: { spots: DeviceSpot[]; onRemove?: (id: string) => void; tag?: (id: string) => string | undefined }) {
  return (
    <div className="cg-floors">
      {groupByFloor(spots).map((f) => (
        <div key={f.label} className="cg-floor">
          <div className="cg-floor-name">{f.label}</div>
          <div className="cg-rooms">
            {f.rooms.map((r) => (
              <div key={r.room} className="cg-room">
                <b>{r.room}</b>
                {r.spots.map((s) => {
                  const t = tag?.(s.device.id);
                  return (
                    <span key={s.device.id} className="cg-dev" title={s.device.sn}>
                      {deviceLabel(s.device)}
                      {t && <i>{t}</i>}
                      {onRemove && <CloseOutlined className="cg-x" title="移出这个组" onClick={() => onRemove(s.device.id)} />}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 护理员详情：资料、二维码（编号）、所在的组（点一下加入 / 退出）、通过这些组负责的设备 */
export function CaregiverDetail({
  c,
  groups,
  members,
  spots,
  onToggle,
  onEdit,
  onDelete,
  onOpenGroup,
}: {
  c: Caregiver;
  groups: CaregiverGroup[];
  members: Map<string, GroupMembers>;
  spots: Map<string, DeviceSpot>;
  onToggle: (groupId: string, join: boolean) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const [busy, setBusy] = useState<string>();
  const mine = groups.filter((g) => members.get(g.id)?.caregivers.includes(c.id));

  // 几个组都有同一台设备时只列一次，标出来自哪几个组
  const covered = useMemo(() => {
    const via = new Map<string, string[]>();
    for (const g of mine) for (const d of members.get(g.id)?.devices ?? []) via.set(d, [...(via.get(d) ?? []), g.groupName]);
    return via;
  }, [mine, members]);
  const coveredSpots = [...covered.keys()].map((id) => spots.get(id)).filter((s): s is DeviceSpot => !!s);

  const info: [string, string | undefined][] = [
    ["编号", c.code],
    ["手机号", c.phone],
    ["性别", c.gender ? GENDER[c.gender] : undefined],
    ["年龄", c.age ? `${c.age} 岁` : undefined],
    ["备注", c.description],
  ];

  return (
    <div className="detail cg-detail">
      <div className="cg-head">
        <div className="detail-title">
          <h1>{c.realName}</h1>
          <Tag color="blue">{caregiverTypeName(c.type)}</Tag>
          {c.answerCall ? (
            <Tag icon={<PhoneOutlined />} color="green">
              接听来电
            </Tag>
          ) : (
            <Tag>不接来电</Tag>
          )}
          <span style={{ marginLeft: "auto" }} />
          <Button icon={<EditOutlined />} onClick={onEdit}>
            编辑
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={onDelete} title="删除" />
        </div>
      </div>

      <div className="cg-profile ops-card">
        <dl className="cg-info">
          {info.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className={k === "编号" ? "mono" : undefined}>{v || <span className="muted">—</span>}</dd>
            </div>
          ))}
        </dl>
        <div className="cg-qr" title="编号的二维码，和网页端'查看二维码'一样">
          <QRCode value={c.code || "-"} size={104} bordered={false} errorLevel="H" />
          <span className="muted small">编号二维码</span>
        </div>
      </div>

      <div className="ops-card">
        <h2>
          所在护理组 <span className="muted small">点一下加入或退出</span>
        </h2>
        {groups.length ? (
          <div className="cg-chips">
            {groups.map((g) => {
              const on = mine.includes(g);
              return (
                <Tag.CheckableTag
                  key={g.id}
                  checked={on}
                  className={busy === g.id ? "busy" : undefined}
                  onChange={async (v) => {
                    if (busy) return;
                    setBusy(g.id);
                    await onToggle(g.id, v);
                    setBusy(undefined);
                  }}
                >
                  {on && "✓ "}
                  {g.groupName}
                </Tag.CheckableTag>
              );
            })}
          </div>
        ) : (
          <span className="muted">还没有护理组，到"护理组"里新建</span>
        )}
      </div>

      <div className="ops-card">
        <h2>
          负责的设备 <span className="muted small">{coveredSpots.length ? `${coveredSpots.length} 台，来自所在的组` : ""}</span>
        </h2>
        {coveredSpots.length ? (
          <DeviceRooms spots={coveredSpots} tag={mine.length > 1 ? (id) => covered.get(id)?.join("、") : undefined} />
        ) : (
          <span className="muted">{mine.length ? "所在的组里还没有设备" : "加入护理组后，这里列出组里的设备"}</span>
        )}
        {mine.length > 0 && (
          <div className="cg-links">
            {mine.map((g) => (
              <Button key={g.id} type="link" size="small" onClick={() => onOpenGroup(g.id)}>
                打开 {g.groupName} →
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 护理组详情：组里的护理员（拖动排顺序，松手就保存）和按房间列的设备 */
export function GroupDetail({
  g,
  m,
  caregivers,
  spots,
  groupsOfPerson,
  onEdit,
  onDelete,
  onSetCaregivers,
  onSetDevices,
  onPickDevices,
  nonRadar,
  onOpenPerson,
}: {
  g: CaregiverGroup;
  m: GroupMembers;
  caregivers: Caregiver[];
  spots: Map<string, DeviceSpot>;
  groupsOfPerson: Map<string, string[]>;
  onEdit: () => void;
  onDelete: () => void;
  onSetCaregivers: (ids: string[]) => Promise<void>;
  onSetDevices: (ids: string[]) => Promise<void>;
  onPickDevices: () => void;
  /** 组里不是雷达的设备数（网页端加的）；这里不显示，提示一下移出 */
  nonRadar: number;
  onOpenPerson: (id: string) => void;
}) {
  const { message } = App.useApp();
  const [adding, setAdding] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  /** 拖动中的顺序（松手前只在本地） */
  const [order, setOrder] = useState<string[]>();
  const [dragId, setDragId] = useState<string>();
  const byId = useMemo(() => new Map(caregivers.map((c) => [c.id, c])), [caregivers]);
  const people = (order ?? m.caregivers).map((id) => byId.get(id)).filter((c): c is Caregiver => !!c);
  const outside = caregivers.filter((c) => !m.caregivers.includes(c.id));
  const devSpots = m.devices.map((id) => spots.get(id)).filter((s): s is DeviceSpot => !!s);

  async function save(what: string, run: () => Promise<void>) {
    setSaving(true);
    try {
      await run();
      message.success(what);
    } catch (e) {
      message.error(`保存失败：${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  function dragOver(overId: string) {
    if (!dragId || dragId === overId) return;
    const n = [...(order ?? m.caregivers)];
    n.splice(n.indexOf(overId), 0, ...n.splice(n.indexOf(dragId), 1));
    setOrder(n);
  }

  async function dragEnd() {
    setDragId(undefined);
    const n = order;
    if (!n || n.join() === m.caregivers.join()) return setOrder(undefined);
    await save("顺序已保存", () => onSetCaregivers(n));
    setOrder(undefined);
  }

  return (
    <div className="detail cg-detail">
      <div className="cg-head">
        <div className="detail-title">
          <h1>{g.groupName}</h1>
          <span className="muted">
            {m.caregivers.length} 名护理员 · {m.devices.length} 台设备
          </span>
          <span style={{ marginLeft: "auto" }} />
          <Button icon={<EditOutlined />} onClick={onEdit}>
            编辑
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={onDelete} title="删除这个组" />
        </div>
        {g.description && <div className="muted cg-desc">{g.description}</div>}
      </div>

      <div className="cg-cols">
        <div className="ops-card">
          <h2>
            护理员 <span className="muted small">拖动排顺序</span>
          </h2>
          <div className="cg-add">
            <Select
              mode="multiple"
              allowClear
              value={adding}
              onChange={setAdding}
              placeholder={outside.length ? "选择要加入的护理员" : caregivers.length ? "全部护理员都在这个组里了" : "还没有护理员"}
              disabled={!outside.length}
              options={outside.map((c) => ({ value: c.id, label: `${c.realName}（${caregiverTypeName(c.type)}）`, search: `${c.realName} ${c.code} ${c.phone ?? ""}` }))}
              optionFilterProp="search"
              maxTagCount="responsive"
              style={{ flex: 1, minWidth: 0 }}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!adding.length}
              loading={saving}
              onClick={() =>
                save(`已加入 ${adding.length} 名护理员`, async () => {
                  await onSetCaregivers([...m.caregivers, ...adding]);
                  setAdding([]);
                })
              }
            >
              加入
            </Button>
          </div>
          {people.length ? (
            <ol className="cg-people">
              {people.map((c, i) => {
                const also = (groupsOfPerson.get(c.id) ?? []).length - 1;
                return (
                  <li
                    key={c.id}
                    className={dragId === c.id ? "dragging" : undefined}
                    draggable={!saving}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(c.id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      dragOver(c.id);
                    }}
                    onDragEnd={dragEnd}
                  >
                    <HolderOutlined className="cg-handle" />
                    <span className="cg-idx">{i + 1}</span>
                    <span className="cg-person" onClick={() => onOpenPerson(c.id)} title="查看护理员">
                      <b>{c.realName}</b>
                      <small>
                        {caregiverTypeName(c.type)}
                        {c.phone ? ` · ${c.phone}` : ""}
                        {c.answerCall ? "" : " · 不接来电"}
                        {also > 0 ? ` · 另在 ${also} 个组` : ""}
                      </small>
                    </span>
                    <Button
                      type="text"
                      size="small"
                      icon={<CloseOutlined />}
                      title="移出这个组"
                      disabled={saving}
                      onClick={() => save(`${c.realName} 已移出`, () => onSetCaregivers(m.caregivers.filter((x) => x !== c.id)))}
                    />
                  </li>
                );
              })}
            </ol>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="组里还没有护理员" />
          )}
        </div>

        <div className="ops-card">
          <h2>
            负责的设备
            <Button size="small" icon={<EditOutlined />} onClick={onPickDevices} style={{ marginLeft: "auto" }}>
              按房间选择
            </Button>
          </h2>
          {nonRadar > 0 && (
            <Alert
              type="warning"
              showIcon
              className="cg-nonradar"
              message={`组里还有 ${nonRadar} 台不是雷达的设备（例如管理主机，可能是在网页端加的），护理组只管雷达`}
              action={
                <Button size="small" loading={saving} onClick={() => save("已移出非雷达设备", () => onSetDevices(m.devices))}>
                  移出
                </Button>
              }
            />
          )}
          {devSpots.length ? (
            <DeviceRooms spots={devSpots} onRemove={(id) => save("已移出", () => onSetDevices(m.devices.filter((x) => x !== id)))} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="组里还没有雷达">
              <Button type="primary" icon={<PlusOutlined />} onClick={onPickDevices}>
                按房间选择雷达
              </Button>
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}
