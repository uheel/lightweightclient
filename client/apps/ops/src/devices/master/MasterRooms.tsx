import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Empty, Space, Spin, Table, Tag, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import { getMasterContacts, getMasterRoomKeys, getMasterRoomTree, saveMasterRoomKeys, type MasterContact, type RoomTreeNode } from "../../api/master";
import type { DevRow } from "../category";

/** 树里所有房间（叶子）的 id */
function leafKeys(nodes: RoomTreeNode[], out: string[] = []) {
  for (const n of nodes) {
    if (n.isLeaf) out.push(n.key);
    else leafKeys(n.children ?? [], out);
  }
  return out;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * 管理主机覆盖哪些房间。保存后平台按这些房间生成通讯录（房间里能通话的雷达和它们的 SIP 号），
 * "保存并下发"时同时推给主机（update.devices），主机上才能看到、拨到这些雷达。
 */
export default function MasterRooms({ d, radars, onSaved }: { d: DevRow; radars: DevRow[]; onSaved?: () => void }) {
  const { message } = App.useApp();
  const [rooms, setRooms] = useState<RoomTreeNode[]>();
  const [saved, setSaved] = useState<string[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [contacts, setContacts] = useState<MasterContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"save" | "issue">();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, keys, c] = await Promise.all([getMasterRoomTree(d), getMasterRoomKeys(d), getMasterContacts(d)]);
      setRooms(t);
      setSaved(keys);
      setChecked(keys);
      setContacts(c);
    } catch (e) {
      message.error(`读取覆盖房间失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [d, message]);

  useEffect(() => {
    load();
  }, [load]);

  const radarsByRoom = useMemo(() => {
    const m = new Map<string, DevRow[]>();
    for (const r of radars) if (r.roomId) m.set(r.roomId, [...(m.get(r.roomId) ?? []), r]);
    return m;
  }, [radars]);

  const allRooms = useMemo(() => leafKeys(rooms ?? []), [rooms]);
  const roomIds = useMemo(() => new Set(allRooms), [allRooms]);

  // 房间后面注明有几台雷达
  const tree = useMemo<DataNode[]>(() => {
    const map = (n: RoomTreeNode): DataNode => {
      if (!n.isLeaf) return { key: n.key, title: n.title, children: (n.children ?? []).map(map) };
      const c = radarsByRoom.get(n.key)?.length ?? 0;
      return {
        key: n.key,
        isLeaf: true,
        title: (
          <span>
            {n.title}
            <span className="muted small">{c ? ` · ${c} 台雷达` : " · 没有雷达"}</span>
          </span>
        ),
      };
    };
    return (rooms ?? []).map(map);
  }, [rooms, radarsByRoom]);

  /** 已勾房间里的雷达不在通讯录里的（不能通话的类型，或没开云对讲 / 没有 SIP 号）；只按已保存的房间算，和通讯录对得上 */
  const missing = useMemo(() => {
    const inBook = new Set(contacts.map((c) => c.deviceId));
    return saved.flatMap((id) => radarsByRoom.get(id) ?? []).filter((r) => !inBook.has(r.id));
  }, [saved, contacts, radarsByRoom]);

  async function save(issued: boolean) {
    setSaving(issued ? "issue" : "save");
    try {
      await saveMasterRoomKeys(d, checked, issued);
      message.success(issued ? "已保存并下发通讯录到主机" : "已保存");
      await load();
      onSaved?.();
    } catch (e) {
      message.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(undefined);
    }
  }

  if (loading && !rooms) return <Spin style={{ margin: 40 }} />;
  const dirty = !sameSet(saved, checked);

  return (
    <div className="detail-body">
      <div className="ops-grid master-rooms">
        <div className="ops-card">
          <h2>
            覆盖的房间
            <span className="muted small" style={{ fontWeight: 400 }}>
              已选 {checked.length} 间{dirty ? "（未保存）" : ""}
            </span>
          </h2>
          {tree.length ? (
            <>
              <Space size={6} style={{ marginBottom: 8 }}>
                <Button size="small" onClick={() => setChecked(allRooms)}>
                  全选
                </Button>
                <Button size="small" onClick={() => setChecked([])}>
                  清空
                </Button>
              </Space>
              <div className="master-tree">
                <Tree
                  checkable
                  selectable={false}
                  defaultExpandAll
                  treeData={tree}
                  checkedKeys={checked}
                  onCheck={(keys) => {
                    const list = Array.isArray(keys) ? keys : keys.checked;
                    setChecked(list.map(String).filter((k) => roomIds.has(k)));
                  }}
                />
              </div>
              <Space style={{ marginTop: 12 }}>
                <Button type="primary" loading={saving === "issue"} disabled={!!saving} onClick={() => save(true)}>
                  保存并下发到主机
                </Button>
                <Button loading={saving === "save"} disabled={!!saving || !dirty} onClick={() => save(false)}>
                  只保存
                </Button>
              </Space>
              {!d.isOnline && <p className="muted small" style={{ marginTop: 8 }}>主机现在离线，下发要等它上线后主动拉取通讯录。</p>}
            </>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="主机所属机构里还没有可选的房间" />
          )}
        </div>
        <div className="ops-card">
          <h2>
            通讯录
            <span className="muted small" style={{ fontWeight: 400 }}>
              {contacts.length} 台雷达，主机上显示和拨打的就是这些
            </span>
          </h2>
          {dirty && <Alert type="info" showIcon style={{ marginBottom: 8 }} message="通讯录按已保存的房间生成，保存后更新" />}
          <Table<MasterContact>
            size="small"
            rowKey="deviceId"
            pagination={false}
            dataSource={contacts}
            locale={{ emptyText: "还没有可通话的雷达" }}
            columns={[
              { title: "房间", dataIndex: "roomName" },
              { title: "雷达", dataIndex: "deviceName", render: (v, c) => v || c.sn },
              { title: "长者", dataIndex: "realName", render: (v) => v || "—" },
              { title: "SIP 号", dataIndex: "callNum", width: 90, render: (v) => (v ? <span className="mono">{v}</span> : <Tag color="red">没有</Tag>) },
              { title: "呼叫方式", dataIndex: "callType", width: 90, render: (v) => (v === 1 ? "云对讲" : v === 0 ? <Tag color="orange">局域网</Tag> : "—") },
            ]}
          />
          {missing.length > 0 && (
            <p className="muted small" style={{ marginTop: 8 }}>
              这些房间里还有 {missing.map((r) => r.deviceName || r.sn).join("、")} 没进通讯录：这类设备不能通话，或者还没分配 SIP 号。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
