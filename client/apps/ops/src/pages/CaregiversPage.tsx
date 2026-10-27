import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, Spin } from "antd";
import { HolderOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, TeamOutlined } from "@ant-design/icons";
import { perfTimer } from "@radar/core";
import {
  caregiverTypeName,
  deleteCaregiver,
  deleteGroup,
  getGroupMembers,
  listCaregivers,
  listGroups,
  setGroupCaregivers,
  setGroupDevices,
  setGroupOrder,
  type Caregiver,
  type CaregiverGroup,
  type GroupDevice,
  type GroupMembers,
} from "../api/caregiver";
import { getDeviceTypeGroups } from "../api/device";
import { useGuide } from "../guide/GuideContext";
import { CaregiverDialog, DevicePicker, GroupDialog } from "../caregivers/dialogs";
import { CaregiverDetail, GroupDetail } from "../caregivers/details";
import { locateDevices } from "../caregivers/model";
import "../caregivers/caregivers.css";
import { ModuleName } from "../workspace/ModuleName";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const byName = (a: string, b: string) => a.localeCompare(b, "zh-CN", { numeric: true });

type Mode = "people" | "groups";

/**
 * 护理班组：护理员和护理组放在一页。左边在"护理员 / 护理组"之间切换，右边是详情：
 * 护理员看所在的组、负责哪些房间的设备，可以直接勾选加入 / 退出组；护理组管理组里的护理员（拖动排顺序）和按房间选的设备。
 * 进页面一次取回护理员、护理组和每个组的成员，之后的筛选、统计、"负责哪些设备"都在本地算；改动只发对应的那一条写请求，不整页重取。
 */
export default function CaregiversPage() {
  const { message, modal } = App.useApp();
  const guide = useGuide();
  const [mode, setMode] = useState<Mode>("people");
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [groups, setGroups] = useState<CaregiverGroup[]>([]);
  /** 平台上的组成员，设备可能有网页端加进去的非雷达（例如管理主机） */
  const [rawMembers, setMembers] = useState<Map<string, GroupMembers>>(new Map());
  const [candidates, setCandidates] = useState<GroupDevice[]>([]);
  /** 雷达类的设备类型（字典 groupCode = RADAR）；护理组只能管雷达 */
  const [radarTypes, setRadarTypes] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selPerson, setSelPerson] = useState<string>();
  const [selGroup, setSelGroup] = useState<string>();
  const [personDlg, setPersonDlg] = useState<{ id?: string }>();
  const [groupDlg, setGroupDlg] = useState<Partial<CaregiverGroup>>();
  const [picking, setPicking] = useState<string>();
  const [dragId, setDragId] = useState<string>();
  const orderBeforeDrag = useRef<string[]>(undefined);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    const pt = perfTimer("护理班组");
    try {
      const [cs, gs, types] = await Promise.all([listCaregivers(), listGroups(), getDeviceTypeGroups()]);
      const per = await Promise.all(gs.map((g) => getGroupMembers(g.id)));
      if (my !== seq.current) return;
      setCaregivers(cs);
      setRadarTypes(new Set([...types].filter(([, g]) => g === "RADAR").map(([t]) => t)));
      setGroups([...gs].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
      setMembers(new Map(gs.map((g, i) => [g.id, per[i].members])));
      // 每个组返回的候选设备都一样（机构里的雷达）；没有组时还不知道，建了第一个组再取
      setCandidates(per[0]?.candidates ?? []);
      pt.info("caregivers", cs.length);
      pt.info("groups", gs.length);
      pt.endAfterPaint();
    } catch (e) {
      message.error(`加载失败：${errText(e)}`);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    load();
    // 设备位置用快速开始取回的雷达和房间；还没取过时补一次轻量检查
    if (guide && !guide.data && !guide.loading) guide.refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // 平台给的候选设备里混有管理主机（3 型，groupCode SLAVE），只留雷达
  const radars = useMemo(() => candidates.filter((d) => d.deviceType !== undefined && radarTypes.has(d.deviceType)), [candidates, radarTypes]);
  const radarIds = useMemo(() => new Set(radars.map((d) => d.id)), [radars]);
  /** 页面上显示、计数、写入都用这份：组里的设备只算雷达。任何一次保存设备都只写雷达，非雷达就顺带移出了 */
  const members = useMemo(
    () => new Map([...rawMembers].map(([g, v]) => [g, { ...v, devices: v.devices.filter((id) => radarIds.has(id)) }])),
    [rawMembers, radarIds],
  );
  const nonRadarOf = (groupId: string) => (rawMembers.get(groupId)?.devices.length ?? 0) - (members.get(groupId)?.devices.length ?? 0);
  const spots = useMemo(() => locateDevices(radars, guide?.data?.radars, guide?.data?.rooms), [radars, guide?.data]);
  const caregiverById = useMemo(() => new Map(caregivers.map((c) => [c.id, c])), [caregivers]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  /** 护理员 → 所在的组（按组的顺序）；设备 → 所在的组 */
  const groupsOfPerson = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of groups) for (const id of members.get(g.id)?.caregivers ?? []) m.set(id, [...(m.get(id) ?? []), g.id]);
    return m;
  }, [groups, members]);
  const groupsOfDevice = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of groups) for (const id of members.get(g.id)?.devices ?? []) m.set(id, [...(m.get(id) ?? []), g.id]);
    return m;
  }, [groups, members]);

  const ungroupedPeople = caregivers.filter((c) => !groupsOfPerson.has(c.id)).length;
  const uncovered = radars.filter((d) => !groupsOfDevice.has(d.id)).length;

  const shownPeople = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return caregivers
      .filter((c) => !kw || [c.realName, c.code, c.phone, caregiverTypeName(c.type), ...(groupsOfPerson.get(c.id) ?? []).map((g) => groupById.get(g)?.groupName)].some((v) => v?.toLowerCase().includes(kw)))
      .sort((a, b) => byName(a.realName, b.realName));
  }, [caregivers, q, groupsOfPerson, groupById]);
  const shownGroups = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return groups.filter((g) => !kw || [g.groupName, g.description].some((v) => v?.toLowerCase().includes(kw)));
  }, [groups, q]);

  // 默认选中第一个，删掉当前的以后也落到第一个
  const person = (selPerson && caregiverById.get(selPerson)) || shownPeople[0];
  const group = (selGroup && groupById.get(selGroup)) || shownGroups[0];

  // ---------- 写操作：成功后只改本地数据 ----------

  const patchMembers = (groupId: string, patch: Partial<GroupMembers>) =>
    setMembers((m) => new Map(m).set(groupId, { caregivers: [], devices: [], ...m.get(groupId), ...patch }));

  async function writeCaregivers(groupId: string, ids: string[]) {
    await setGroupCaregivers(groupId, ids);
    patchMembers(groupId, { caregivers: ids });
  }

  async function writeDevices(groupId: string, ids: string[]) {
    await setGroupDevices(groupId, ids);
    patchMembers(groupId, { devices: ids });
  }

  /** 改一位护理员所在的组：只写有变化的组，新加入的排在组里最后 */
  async function setPersonGroups(id: string, groupIds: string[]) {
    const jobs = groups
      .map((g) => {
        const cur = members.get(g.id)?.caregivers ?? [];
        const want = groupIds.includes(g.id);
        if (want === cur.includes(id)) return undefined;
        return writeCaregivers(g.id, want ? [...cur, id] : cur.filter((x) => x !== id));
      })
      .filter(Boolean);
    await Promise.all(jobs);
  }

  async function toggleGroup(c: Caregiver, groupId: string, join: boolean) {
    const cur = groupsOfPerson.get(c.id) ?? [];
    try {
      await setPersonGroups(c.id, join ? [...cur, groupId] : cur.filter((g) => g !== groupId));
      message.success(`${c.realName} 已${join ? "加入" : "退出"}${groupById.get(groupId)?.groupName}`);
    } catch (e) {
      message.error(`保存失败：${errText(e)}`);
    }
  }

  function askDeletePerson(c: Caregiver) {
    const gs = (groupsOfPerson.get(c.id) ?? []).map((g) => groupById.get(g)?.groupName).filter(Boolean);
    modal.confirm({
      title: `删除护理员"${c.realName}"？`,
      content: gs.length ? `会同时退出 ${gs.join("、")}。平台上不能恢复。` : "平台上不能恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteCaregiver(c.id);
          message.success("已删除");
          setCaregivers((l) => l.filter((x) => x.id !== c.id));
          // 平台删人时自动移出各组，本地跟着去掉
          setMembers((m) => new Map([...m].map(([g, v]) => [g, { ...v, caregivers: v.caregivers.filter((x) => x !== c.id) }])));
          setSelPerson(undefined);
        } catch (e) {
          message.error(`删除失败：${errText(e)}`);
        }
      },
    });
  }

  function askDeleteGroup(g: CaregiverGroup) {
    const m = members.get(g.id);
    modal.confirm({
      title: `删除护理组"${g.groupName}"？`,
      content: `组里的 ${m?.caregivers.length ?? 0} 名护理员和 ${m?.devices.length ?? 0} 台设备不会被删除，只是不再属于这个组。`,
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteGroup(g.id);
          message.success("已删除");
          setGroups((l) => l.filter((x) => x.id !== g.id));
          setMembers((mm) => {
            const n = new Map(mm);
            n.delete(g.id);
            return n;
          });
          setSelGroup(undefined);
        } catch (e) {
          message.error(`删除失败：${errText(e)}`);
        }
      },
    });
  }

  // ---------- 拖动护理组排顺序：松手时保存 ----------

  function dragOver(overId: string) {
    if (!dragId || dragId === overId) return;
    setGroups((l) => {
      const from = l.findIndex((x) => x.id === dragId);
      const to = l.findIndex((x) => x.id === overId);
      const n = [...l];
      n.splice(to, 0, ...n.splice(from, 1));
      return n;
    });
  }

  async function dragEnd() {
    setDragId(undefined);
    const before = orderBeforeDrag.current;
    orderBeforeDrag.current = undefined;
    const now = groups.map((g) => g.id);
    if (!before || before.join() === now.join()) return;
    try {
      await setGroupOrder(now);
      setGroups((l) => l.map((g, i) => ({ ...g, sortOrder: i + 1 })));
    } catch (e) {
      message.error(`保存顺序失败：${errText(e)}`);
      setGroups((l) => before.map((id) => l.find((g) => g.id === id)!).filter(Boolean));
    }
  }

  const codes = useMemo(() => new Map(caregivers.map((c) => [c.code, c.id])), [caregivers]);
  const groupNames = useMemo(() => new Map(groups.map((g) => [g.groupName, g.id])), [groups]);
  const pickingGroup = picking ? groupById.get(picking) : undefined;
  const isPeople = mode === "people";

  return (
    <div className="workbench">
      <section className="dev-list">
        <div className="dev-list-head">
          <div className="dev-list-title">
            <h1><ModuleName k="caregivers" /></h1>
            <span className="muted">
              {caregivers.length} 名护理员 · {groups.length} 个组
            </span>
            <Button type="text" icon={<ReloadOutlined />} onClick={load} title="刷新" style={{ marginLeft: "auto" }} />
          </div>
          <div className="seg">
            <button className={isPeople ? "on" : ""} onClick={() => setMode("people")}>
              护理员 <b>{caregivers.length}</b>
            </button>
            <button className={!isPeople ? "on" : ""} onClick={() => setMode("groups")}>
              护理组 <b>{groups.length}</b>
            </button>
          </div>
          <div className="dev-list-search">
            <Input allowClear prefix={<SearchOutlined style={{ color: "#8A8FA8" }} />} placeholder={isPeople ? "姓名 / 编号 / 手机号 / 组名" : "组名"} value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => (isPeople ? setPersonDlg({}) : setGroupDlg({}))}>
              新建
            </Button>
          </div>
        </div>
        <div className="dev-rows" role="listbox" aria-label={isPeople ? "护理员" : "护理组"}>
          {loading && !caregivers.length && !groups.length ? (
            <Spin style={{ margin: 40 }} />
          ) : isPeople ? (
            shownPeople.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={caregivers.length ? "没有符合条件的护理员" : "还没有护理员"} />
            ) : (
              shownPeople.map((c) => {
                const gs = (groupsOfPerson.get(c.id) ?? []).map((g) => groupById.get(g)?.groupName);
                return (
                  <div key={c.id} role="option" aria-selected={c.id === person?.id} className={`dev-row${c.id === person?.id ? " on" : ""}`} onClick={() => setSelPerson(c.id)}>
                    <span className="dev-row-main">
                      <b>{c.realName}</b>
                      <small>
                        {caregiverTypeName(c.type)} · <span className="mono">{c.code}</span>
                        {c.answerCall ? "" : " · 不接来电"}
                      </small>
                    </span>
                    <span className={`dev-row-last${gs.length ? "" : " off"}`} title={gs.join("、")}>
                      {gs.length ? (gs.length > 1 ? `${gs[0]} 等 ${gs.length} 组` : gs[0]) : "未分组"}
                    </span>
                  </div>
                );
              })
            )
          ) : shownGroups.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={groups.length ? "没有符合条件的护理组" : "还没有护理组"} />
          ) : (
            shownGroups.map((g) => {
              const m = members.get(g.id);
              const canDrag = !q.trim();
              return (
                <div
                  key={g.id}
                  role="option"
                  aria-selected={g.id === group?.id}
                  className={`dev-row cg-group-row${g.id === group?.id ? " on" : ""}${dragId === g.id ? " dragging" : ""}`}
                  onClick={() => setSelGroup(g.id)}
                  draggable={canDrag}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    orderBeforeDrag.current = groups.map((x) => x.id);
                    setDragId(g.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    dragOver(g.id);
                  }}
                  onDragEnd={dragEnd}
                >
                  {canDrag && <HolderOutlined className="cg-handle" title="拖动排顺序" />}
                  <span className="dev-row-main">
                    <b>{g.groupName}</b>
                    <small>
                      {m?.caregivers.length ?? 0} 名护理员 · {m?.devices.length ?? 0} 台设备
                    </small>
                  </span>
                  {!m?.caregivers.length && m?.devices.length ? <span className="dev-row-last err-text">没有护理员</span> : null}
                </div>
              );
            })
          )}
        </div>
        <div className="dev-list-foot muted">
          {isPeople
            ? ungroupedPeople
              ? `${ungroupedPeople} 名还没分组`
              : caregivers.length
                ? "都已分组"
                : ""
            : groups.length
              ? `${uncovered ? `${uncovered} 台雷达不在任何组` : "雷达都已分到组"} · 拖动排顺序`
              : ""}
        </div>
      </section>

      <section className="dev-detail">
        {loading && !caregivers.length && !groups.length ? null : isPeople ? (
          person ? (
            <CaregiverDetail
              key={person.id}
              c={person}
              groups={groups}
              members={members}
              spots={spots}
              onToggle={(gid, join) => toggleGroup(person, gid, join)}
              onEdit={() => setPersonDlg({ id: person.id })}
              onDelete={() => askDeletePerson(person)}
              onOpenGroup={(gid) => {
                setMode("groups");
                setQ("");
                setSelGroup(gid);
              }}
            />
          ) : (
            <Empty className="cg-empty" image={<TeamOutlined className="cg-empty-icon" />} description="把护理员录进来，再按楼层或班次分组，指定每组负责哪些房间的设备。">
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setPersonDlg({})}>
                新建护理员
              </Button>
            </Empty>
          )
        ) : group ? (
          <GroupDetail
            key={group.id}
            g={group}
            m={members.get(group.id) ?? { caregivers: [], devices: [] }}
            nonRadar={nonRadarOf(group.id)}
            caregivers={caregivers}
            spots={spots}
            groupsOfPerson={groupsOfPerson}
            onEdit={() => setGroupDlg(group)}
            onDelete={() => askDeleteGroup(group)}
            onSetCaregivers={(ids) => writeCaregivers(group.id, ids)}
            onSetDevices={(ids) => writeDevices(group.id, ids)}
            onPickDevices={() => setPicking(group.id)}
            onOpenPerson={(id) => {
              setMode("people");
              setQ("");
              setSelPerson(id);
            }}
          />
        ) : (
          <Empty className="cg-empty" image={<TeamOutlined className="cg-empty-icon" />} description="护理组把一批护理员和所负责的设备放在一起，例如按楼层或班次分。">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setGroupDlg({})}>
              新建护理组
            </Button>
          </Empty>
        )}
      </section>

      <CaregiverDialog
        target={personDlg}
        groups={groups}
        groupsOf={(id) => groupsOfPerson.get(id) ?? []}
        codes={codes}
        onClose={() => setPersonDlg(undefined)}
        onSaved={async (c, groupIds) => {
          setCaregivers((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? { ...x, ...c } : x)) : [...l, c]));
          setPersonDlg(undefined);
          setSelPerson(c.id);
          try {
            await setPersonGroups(c.id, groupIds);
            message.success(personDlg?.id ? "已保存" : "已新建");
          } catch (e) {
            message.error(`护理员已保存，但分组没保存上：${errText(e)}`);
          }
        }}
      />
      <GroupDialog
        target={groupDlg}
        names={groupNames}
        onClose={() => setGroupDlg(undefined)}
        onSaved={async (g) => {
          const isNew = !groupDlg?.id;
          setGroupDlg(undefined);
          setGroups((l) => (isNew ? [...l, g] : l.map((x) => (x.id === g.id ? { ...x, ...g } : x))));
          setSelGroup(g.id);
          message.success(isNew ? "已新建，接着把护理员和设备加进来" : "已保存");
          if (isNew) {
            patchMembers(g.id, { caregivers: [], devices: [] });
            // 第一个组建好后才拿得到可选设备
            if (!candidates.length) getGroupMembers(g.id).then((r) => setCandidates(r.candidates), () => {});
          }
        }}
      />
      <DevicePicker
        open={!!pickingGroup}
        title={`${pickingGroup?.groupName ?? ""} 负责的雷达`}
        spots={[...spots.values()]}
        selected={pickingGroup ? (members.get(pickingGroup.id)?.devices ?? []) : []}
        otherGroups={(id) => (groupsOfDevice.get(id) ?? []).filter((g) => g !== picking).map((g) => groupById.get(g)?.groupName ?? "")}
        onClose={() => setPicking(undefined)}
        onOk={async (ids) => {
          if (!picking) return;
          try {
            await writeDevices(picking, ids.filter((id) => radarIds.has(id)));
            message.success("已保存");
            setPicking(undefined);
          } catch (e) {
            message.error(`保存失败：${errText(e)}`);
          }
        }}
      />
    </div>
  );
}
