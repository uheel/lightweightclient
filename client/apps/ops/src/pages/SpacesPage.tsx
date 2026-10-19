import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Dropdown, Empty, Input, InputNumber, Spin } from "antd";
import { CaretDownOutlined, CaretRightOutlined, DeleteOutlined, MoreOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { perfTimer } from "@radar/core";
import { bindBedDevice, getRadars, getRoomDevices, unbindBedKeepRoom, type RoomDevice } from "../api/device";
import type { Room } from "../api/room";
import {
  createBed,
  createBuilding,
  deleteBed,
  deleteBuilding,
  deleteFloor,
  deleteRoom,
  getSpaces,
  renameBed,
  renameBuilding,
  renameRoom,
  setRoomSize,
  updateFloor,
  type BedRow,
  type Building,
  type Floor,
} from "../api/space";
import EditableText from "../spaces/EditableText";
import RoomPanel from "../spaces/RoomPanel";
import { AddFloorsDialog, AddRoomsDialog, BedCheckInDialog, DeleteDialog } from "../spaces/dialogs";
import { indexSpaces, roomsOfBuilding, roomsOfFloor, tallyRooms, without, type Spaces, type Tally } from "../spaces/model";
import { nextBedName } from "../spaces/names";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const EMPTY: Spaces = { buildings: [], floors: [], rooms: [], beds: [], radars: [] };
const occupied = (b: BedRow) => b.bedStatus === 2 || !!b.realName;

type Sel = { kind: "building" | "floor"; id: string };
type DeleteTarget = { title: string; name: string; tally: Tally; askName: boolean; run: () => Promise<void> };

/**
 * 楼宇：楼栋 / 楼层 / 房间 / 床位的基础资料。左边楼栋 › 楼层树，右边是选中楼层的房间格子，点房间在右侧改名、改尺寸、管床位。
 * 没有户型：房间挂在机构的共用空白户型上，批量建房时可以照着一间已有的房间布置。
 * 进页面一次取回楼栋、楼层、房间、床位和雷达，之后分组、统计、删除前的影响范围都在本地算；改名、删除只改本地数据，新建后静默刷新一次。
 */
export default function SpacesPage() {
  const { message } = App.useApp();
  const [data, setData] = useState<Spaces>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Sel>();
  const [roomId, setRoomId] = useState<string>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingBuilding, setAddingBuilding] = useState(false);
  const [newBuilding, setNewBuilding] = useState("");
  const [floorsFor, setFloorsFor] = useState<Building>();
  const [roomsFor, setRoomsFor] = useState<{ building: Building; floor: Floor }>();
  const [del, setDel] = useState<DeleteTarget>();
  const [checkInBed, setCheckInBed] = useState<BedRow>();
  /** 选中房间里的设备和它们绑的床位（只有床位绑定要单独取） */
  const [roomDevices, setRoomDevices] = useState<{ roomId: string; list: RoomDevice[] }>();
  const seq = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      const my = ++seq.current;
      if (!quiet) setLoading(true);
      const pt = perfTimer("楼宇");
      try {
        const [s, radars] = await Promise.all([getSpaces(), getRadars()]);
        if (my !== seq.current) return;
        setData({ ...s, radars });
        pt.info("rooms", s.rooms.length);
        pt.info("beds", s.beds.length);
        pt.endAfterPaint();
      } catch (e) {
        message.error(`加载失败：${errText(e)}`);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    load();
  }, [load]);

  const ix = useMemo(() => indexSpaces(data), [data]);

  // 选中的东西被删掉或还没选时：落到它的上一级，或第一栋楼的第一层
  useEffect(() => {
    if (loading) return;
    if (sel?.kind === "floor" && ix.floor.has(sel.id)) return;
    if (sel?.kind === "building" && ix.building.has(sel.id)) return;
    const b = ix.buildings[0];
    if (!b) return setSel(undefined);
    const f = ix.floorsOf.get(b.id)?.[0];
    setSel(f ? { kind: "floor", id: f.id } : { kind: "building", id: b.id });
    setExpanded((s) => new Set(s).add(b.id));
  }, [ix, sel, loading]);

  useEffect(() => {
    if (roomId && !ix.room.has(roomId)) setRoomId(undefined);
  }, [ix, roomId]);

  const curFloor = sel?.kind === "floor" ? ix.floor.get(sel.id) : undefined;
  const curBuilding = sel ? (sel.kind === "building" ? ix.building.get(sel.id) : curFloor && ix.building.get(curFloor.buildingId)) : undefined;
  const curRoom = roomId ? ix.room.get(roomId) : undefined;

  const loadRoomDevices = useCallback(
    (id: string) =>
      getRoomDevices(id).then(
        (list) => setRoomDevices({ roomId: id, list }),
        () => setRoomDevices({ roomId: id, list: [] }),
      ),
    [],
  );
  useEffect(() => {
    if (roomId) loadRoomDevices(roomId);
  }, [roomId, loadRoomDevices]);

  function pick(s: Sel) {
    setSel(s);
    setRoomId(undefined);
  }

  /** 平台写操作：失败时提示并抛出（原地编辑框据此留在编辑状态） */
  async function act<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      message.error(`${what}失败：${errText(e)}`);
      throw e;
    }
  }

  // ---------- 楼栋 ----------

  async function addBuilding() {
    const name = newBuilding.trim();
    if (!name) return setAddingBuilding(false);
    try {
      const id = await act("新建楼栋", () => createBuilding(name));
      const b: Building = { id, buildingName: name };
      setData((d) => ({ ...d, buildings: [...d.buildings, b] }));
      setNewBuilding("");
      setAddingBuilding(false);
      setExpanded((s) => new Set(s).add(id));
      pick({ kind: "building", id });
      // 新楼栋紧接着加楼层
      setFloorsFor(b);
    } catch {
      // 已提示
    }
  }

  const onRenameBuilding = (b: Building) => async (name: string) => {
    await act("改名", () => renameBuilding(b.id, name));
    setData((d) => ({
      ...d,
      buildings: d.buildings.map((x) => (x.id === b.id ? { ...x, buildingName: name } : x)),
      rooms: d.rooms.map((r) => (r.buildingId === b.id ? { ...r, buildingName: name } : r)),
    }));
  };

  function askDeleteBuilding(b: Building) {
    const floors = ix.floorsOf.get(b.id) ?? [];
    setDel({
      title: `删除楼栋"${b.buildingName}"`,
      name: b.buildingName,
      tally: tallyRooms(ix, roomsOfBuilding(ix, b.id), floors.length),
      askName: floors.length > 0,
      run: async () => {
        await deleteBuilding(b);
        setData((d) => without(d, { buildings: [b.id] }));
      },
    });
  }

  // ---------- 楼层 ----------

  const onRenameFloor = (f: Floor) => async (name: string) => {
    await act("改名", () => updateFloor(f.id, { floorName: name }));
    setData((d) => ({
      ...d,
      floors: d.floors.map((x) => (x.id === f.id ? { ...x, floorName: name } : x)),
      rooms: d.rooms.map((r) => (r.floorId === f.id ? { ...r, floorName: name } : r)),
    }));
  };

  async function setFloorNumber(f: Floor, n: number) {
    if (n === f.floorNumber) return;
    try {
      await act("改楼层号", () => updateFloor(f.id, { floorNumber: n }));
      setData((d) => ({ ...d, floors: d.floors.map((x) => (x.id === f.id ? { ...x, floorNumber: n } : x)) }));
    } catch {
      // 已提示
    }
  }

  function askDeleteFloor(f: Floor) {
    const rooms = roomsOfFloor(ix, f.id);
    setDel({
      title: `删除楼层"${ix.building.get(f.buildingId)?.buildingName ?? ""} › ${f.floorName}"`,
      name: f.floorName,
      tally: tallyRooms(ix, rooms),
      askName: rooms.length > 0,
      run: async () => {
        await deleteFloor(f);
        setData((d) => without(d, { floors: [f.id] }));
      },
    });
  }

  // ---------- 房间 ----------

  const roomLabel = useCallback((r: Room) => [r.buildingName, r.floorName, r.roomName].filter(Boolean).join(" › "), []);

  /** 房间改名时，带着旧房号前缀的床位（101-1床）跟着改成新房号 */
  async function onRenameRoom(r: Room, name: string) {
    await act("改名", () => renameRoom(r.id, name));
    setData((d) => ({ ...d, rooms: d.rooms.map((x) => (x.id === r.id ? { ...x, roomName: name } : x)) }));
    const prefix = `${r.roomName}-`;
    const beds = (ix.bedsOf.get(r.id) ?? []).filter((b) => b.bedName.startsWith(prefix));
    const renamed = new Map<string, string>();
    await Promise.all(
      beds.map((b) => {
        const n = name + b.bedName.slice(r.roomName.length);
        return renameBed(b.id, n).then(() => renamed.set(b.id, n), () => {});
      }),
    );
    if (renamed.size) setData((d) => ({ ...d, beds: d.beds.map((x) => (renamed.has(x.id) ? { ...x, bedName: renamed.get(x.id)! } : x)) }));
    if (renamed.size < beds.length) message.warning(`有 ${beds.length - renamed.size} 张床位没跟着改名，可以在床位上双击再改`);
  }

  async function onResize(r: Room, w: number, l: number) {
    await act("改尺寸", () => setRoomSize(r.id, w, l));
    setData((d) => ({ ...d, rooms: d.rooms.map((x) => (x.id === r.id ? { ...x, roomWidth: w, roomLong: l } : x)) }));
    message.success("尺寸已保存");
  }

  function askDeleteRoom(r: Room) {
    setDel({
      title: `删除房间"${roomLabel(r)}"`,
      name: r.roomName,
      // 房间本身不算在"一起删除"里
      tally: { ...tallyRooms(ix, [r]), rooms: 0 },
      askName: false,
      run: async () => {
        await deleteRoom(r);
        setData((d) => without(d, { rooms: [r.id] }));
      },
    });
  }

  // ---------- 床位 ----------

  async function onAddBed(r: Room) {
    const name = nextBedName(r.roomName, (ix.bedsOf.get(r.id) ?? []).map((b) => b.bedName));
    const id = await act("加床位", () => createBed(r.id, name));
    setData((d) => ({ ...d, beds: [...d.beds, { id, bedName: name, roomId: r.id, floorId: r.floorId, buildingId: r.buildingId, bedStatus: 1, sortOrder: 0 }] }));
  }

  async function onRenameBed(b: BedRow, name: string) {
    await act("改名", () => renameBed(b.id, name));
    setData((d) => ({ ...d, beds: d.beds.map((x) => (x.id === b.id ? { ...x, bedName: name } : x)) }));
  }

  async function onBindBedDevice(r: Room, b: BedRow, deviceId: string) {
    await act("绑设备", () => bindBedDevice(b.id, deviceId));
    setData((d) => ({ ...d, beds: d.beds.map((x) => (x.id === b.id ? { ...x, deviceCount: (x.deviceCount ?? 0) + 1 } : x)) }));
    await loadRoomDevices(r.id);
  }

  /** 平台解绑床位会连房间绑定一起清掉，解绑后再绑回本房间 */
  async function onUnbindBedDevice(r: Room, b: BedRow, dev: RoomDevice) {
    await act("解绑", () => unbindBedKeepRoom(b.id, r.id, dev.deviceId));
    setData((d) => ({ ...d, beds: d.beds.map((x) => (x.id === b.id ? { ...x, deviceCount: Math.max(0, (x.deviceCount ?? 1) - 1) } : x)) }));
    await loadRoomDevices(r.id);
  }

  async function onDeleteBed(b: BedRow) {
    await act("删除床位", () => deleteBed(b));
    setData((d) => without(d, { beds: [b.id] }));
  }

  // ---------- 渲染 ----------

  const allBeds = data.beds.length;
  const floorTally = (f: Floor) => tallyRooms(ix, roomsOfFloor(ix, f.id));

  return (
    <div className="workbench">
      <section className="dev-list space-tree">
        <div className="dev-list-head">
          <div className="dev-list-title">
            <h1>楼宇</h1>
            <span className="muted">
              {ix.buildings.length} 栋 · {data.rooms.length} 间 · {allBeds} 床
            </span>
            <Button type="text" icon={<ReloadOutlined />} onClick={() => load()} title="刷新" style={{ marginLeft: "auto" }} />
          </div>
        </div>
        <div className="dev-rows" role="tree" aria-label="楼栋和楼层">
          {loading && !data.buildings.length ? (
            <Spin style={{ margin: 40 }} />
          ) : (
            ix.buildings.map((b) => {
              const floors = ix.floorsOf.get(b.id) ?? [];
              const open = expanded.has(b.id);
              const rooms = roomsOfBuilding(ix, b.id).length;
              return (
                <div key={b.id} role="treeitem" aria-expanded={open}>
                  <div className={`dev-row space-b${sel?.kind === "building" && sel.id === b.id ? " on" : ""}`} onClick={() => pick({ kind: "building", id: b.id })}>
                    <span
                      className="space-caret"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded((s) => {
                          const n = new Set(s);
                          if (n.has(b.id)) n.delete(b.id);
                          else n.add(b.id);
                          return n;
                        });
                      }}
                    >
                      {floors.length ? open ? <CaretDownOutlined /> : <CaretRightOutlined /> : null}
                    </span>
                    <span className="dev-row-main">
                      <b>{b.buildingName}</b>
                      <small>
                        {floors.length} 层 · {rooms} 间
                      </small>
                    </span>
                  </div>
                  {open &&
                    floors.map((f) => {
                      const t = floorTally(f);
                      return (
                        <div key={f.id} role="treeitem" className={`dev-row space-f${sel?.kind === "floor" && sel.id === f.id ? " on" : ""}`} onClick={() => pick({ kind: "floor", id: f.id })}>
                          <span className="dev-row-main">
                            <b>{f.floorName}</b>
                          </span>
                          <span className="dev-row-last off">
                            {t.rooms} 间 · {t.beds} 床
                          </span>
                        </div>
                      );
                    })}
                </div>
              );
            })
          )}
          {!loading && !data.buildings.length && !addingBuilding && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有楼栋" />}
        </div>
        <div className="space-tree-foot">
          {addingBuilding ? (
            <Input
              autoFocus
              size="small"
              placeholder="楼栋名称，回车新建"
              maxLength={32}
              value={newBuilding}
              onChange={(e) => setNewBuilding(e.target.value)}
              onPressEnter={addBuilding}
              onBlur={() => !newBuilding.trim() && setAddingBuilding(false)}
              onKeyDown={(e) => e.key === "Escape" && setAddingBuilding(false)}
            />
          ) : (
            <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => setAddingBuilding(true)}>
              新建楼栋
            </Button>
          )}
        </div>
      </section>

      <section className="dev-detail space-main">
        {curFloor && curBuilding ? (
          <FloorView
            key={curFloor.id}
            building={curBuilding}
            floor={curFloor}
            rooms={roomsOfFloor(ix, curFloor.id)}
            bedsOf={(id) => ix.bedsOf.get(id) ?? []}
            radarsOf={(id) => ix.radarsOf.get(id)?.length ?? 0}
            tally={floorTally(curFloor)}
            selRoom={roomId}
            onPickRoom={(id) => setRoomId((cur) => (cur === id ? undefined : id))}
            onPickBuilding={() => pick({ kind: "building", id: curBuilding.id })}
            onRename={onRenameFloor(curFloor)}
            onNumber={(n) => setFloorNumber(curFloor, n)}
            onAddRooms={() => setRoomsFor({ building: curBuilding, floor: curFloor })}
            onDelete={() => askDeleteFloor(curFloor)}
            panel={
              curRoom && (
                <RoomPanel
                  room={curRoom}
                  place={`${curBuilding.buildingName} › ${curFloor.floorName}`}
                  beds={ix.bedsOf.get(curRoom.id) ?? []}
                  radars={ix.radarsOf.get(curRoom.id) ?? []}
                  roomDevices={roomDevices?.roomId === curRoom.id ? roomDevices.list : undefined}
                  onCheckIn={setCheckInBed}
                  onBindBedDevice={(b, id) => onBindBedDevice(curRoom, b, id)}
                  onUnbindBedDevice={(b, dev) => onUnbindBedDevice(curRoom, b, dev)}
                  onClose={() => setRoomId(undefined)}
                  onRename={(n) => onRenameRoom(curRoom, n)}
                  onResize={(w, l) => onResize(curRoom, w, l)}
                  onAddBed={() => onAddBed(curRoom)}
                  onRenameBed={onRenameBed}
                  onDeleteBed={onDeleteBed}
                  onDelete={() => askDeleteRoom(curRoom)}
                />
              )
            }
          />
        ) : curBuilding ? (
          <BuildingView
            building={curBuilding}
            floors={ix.floorsOf.get(curBuilding.id) ?? []}
            floorTally={floorTally}
            onPickFloor={(id) => pick({ kind: "floor", id })}
            onRename={onRenameBuilding(curBuilding)}
            onAddFloors={() => setFloorsFor(curBuilding)}
            onDelete={() => askDeleteBuilding(curBuilding)}
          />
        ) : loading ? (
          <Spin style={{ margin: 80 }} />
        ) : (
          <Empty style={{ marginTop: 120 }} description="先在左下角新建一栋楼">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddingBuilding(true)}>
              新建楼栋
            </Button>
          </Empty>
        )}
      </section>

      <AddFloorsDialog
        building={floorsFor}
        floors={floorsFor ? ix.floorsOf.get(floorsFor.id) ?? [] : []}
        onClose={() => setFloorsFor(undefined)}
        onDone={() => {
          const b = floorsFor;
          setFloorsFor(undefined);
          if (b) setExpanded((s) => new Set(s).add(b.id));
          load(true);
        }}
      />
      <AddRoomsDialog
        target={roomsFor && { ...roomsFor, existing: roomsOfFloor(ix, roomsFor.floor.id) }}
        rooms={data.rooms}
        roomLabel={roomLabel}
        onClose={() => setRoomsFor(undefined)}
        onDone={() => load(true)}
      />
      <BedCheckInDialog
        bed={checkInBed}
        place={curRoom ? roomLabel(curRoom) : ""}
        onClose={() => setCheckInBed(undefined)}
        onDone={(name) => {
          const b = checkInBed;
          setCheckInBed(undefined);
          if (b) setData((d) => ({ ...d, beds: d.beds.map((x) => (x.id === b.id ? { ...x, bedStatus: 2, realName: name } : x)) }));
        }}
      />
      <DeleteDialog
        target={del}
        onCancel={() => setDel(undefined)}
        onConfirm={async () => {
          if (!del) return;
          try {
            await del.run();
            message.success("已删除");
            setDel(undefined);
          } catch (e) {
            message.error(`删除失败：${errText(e)}`);
          }
        }}
      />
    </div>
  );
}

/** 楼栋：楼层列表 */
function BuildingView({
  building,
  floors,
  floorTally,
  onPickFloor,
  onRename,
  onAddFloors,
  onDelete,
}: {
  building: Building;
  floors: Floor[];
  floorTally: (f: Floor) => Tally;
  onPickFloor: (id: string) => void;
  onRename: (name: string) => Promise<void>;
  onAddFloors: () => void;
  onDelete: () => void;
}) {
  const ts = floors.map(floorTally);
  const sum = (k: "rooms" | "beds") => ts.reduce((n, t) => n + t[k], 0);
  const people = ts.reduce((n, t) => n + t.occupied.length, 0);
  return (
    <div className="space-view">
      <div className="space-head">
        <EditableText key={building.id} value={building.buildingName} onSave={onRename} className="space-title" />
        <span className="muted small">
          {floors.length} 层 · {sum("rooms")} 间 · {sum("beds")} 床 · {people} 人入住
        </span>
        <span className="grow" />
        <Button type="primary" icon={<PlusOutlined />} onClick={onAddFloors}>
          加楼层
        </Button>
        <Dropdown menu={{ items: [{ key: "del", label: "删除楼栋", danger: true, icon: <DeleteOutlined />, onClick: onDelete }] }} trigger={["click"]}>
          <Button icon={<MoreOutlined />} />
        </Dropdown>
      </div>
      {floors.length ? (
        <div className="space-floors">
          {[...floors].reverse().map((f, i) => {
            const t = ts[floors.length - 1 - i]!;
            return (
              <button key={f.id} className="space-floor" onClick={() => onPickFloor(f.id)}>
                <b>{f.floorName}</b>
                <span className="muted">
                  {t.rooms} 间 · {t.beds} 床 · {t.occupied.length} 人入住
                </span>
                {t.radars > 0 && <span className="muted">{t.radars} 台雷达</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <Empty style={{ marginTop: 80 }} description="这栋楼还没有楼层">
          <Button type="primary" icon={<PlusOutlined />} onClick={onAddFloors}>
            加楼层
          </Button>
        </Empty>
      )}
    </div>
  );
}

/** 楼层：房间格子 + 选中房间的面板 */
function FloorView({
  building,
  floor,
  rooms,
  bedsOf,
  radarsOf,
  tally,
  selRoom,
  onPickRoom,
  onPickBuilding,
  onRename,
  onNumber,
  onAddRooms,
  onDelete,
  panel,
}: {
  building: Building;
  floor: Floor;
  rooms: Room[];
  bedsOf: (roomId: string) => BedRow[];
  radarsOf: (roomId: string) => number;
  tally: Tally;
  selRoom?: string;
  onPickRoom: (id: string) => void;
  onPickBuilding: () => void;
  onRename: (name: string) => Promise<void>;
  onNumber: (n: number) => void;
  onAddRooms: () => void;
  onDelete: () => void;
  panel?: React.ReactNode;
}) {
  const [num, setNum] = useState<number | null>(floor.floorNumber ?? 0);
  useEffect(() => setNum(floor.floorNumber ?? 0), [floor.floorNumber]);
  const commitNum = () => (num === null ? setNum(floor.floorNumber ?? 0) : onNumber(num));

  return (
    <div className="space-view">
      <div className="space-head">
        <button className="space-crumb" onClick={onPickBuilding}>
          {building.buildingName} ›
        </button>
        <EditableText value={floor.floorName} onSave={onRename} className="space-title" />
        <span className="space-num muted small">
          楼层号
          <InputNumber size="small" min={-5} max={99} value={num} onChange={setNum} onBlur={commitNum} onPressEnter={commitNum} style={{ width: 56 }} />
        </span>
        <span className="muted small">
          {tally.rooms} 间 · {tally.beds} 床 · {tally.occupied.length} 人入住
        </span>
        <span className="grow" />
        <Button type="primary" icon={<PlusOutlined />} onClick={onAddRooms}>
          加房间
        </Button>
        <Dropdown menu={{ items: [{ key: "del", label: "删除楼层", danger: true, icon: <DeleteOutlined />, onClick: onDelete }] }} trigger={["click"]}>
          <Button icon={<MoreOutlined />} />
        </Dropdown>
      </div>
      <div className="space-body">
        <div className="space-scroll">
          {rooms.length ? (
            <div className="space-grid">
              {rooms.map((r) => {
                const beds = bedsOf(r.id);
                const radars = radarsOf(r.id);
                return (
                  <button key={r.id} className={`space-room${selRoom === r.id ? " on" : ""}`} onClick={() => onPickRoom(r.id)}>
                    <span className="space-room-head">
                      <b>{r.roomName}</b>
                      <span className="muted small">{r.roomWidth && r.roomLong ? `${r.roomWidth}×${r.roomLong} m` : ""}</span>
                    </span>
                    <span className="space-room-beds">
                      {beds.length === 0 && <span className="muted small">没有床位</span>}
                      {beds.slice(0, 6).map((b) => (
                        <span key={b.id} className={`space-bed${occupied(b) ? " on" : ""}`} title={b.bedName}>
                          {occupied(b) ? b.realName ?? "已住" : "空"}
                        </span>
                      ))}
                      {beds.length > 6 && <span className="muted small">+{beds.length - 6}</span>}
                    </span>
                    <span className="space-room-foot muted small">{radars ? `${radars} 台雷达` : "无雷达"}</span>
                  </button>
                );
              })}
              <button className="space-room add" onClick={onAddRooms}>
                <PlusOutlined /> 加房间
              </button>
            </div>
          ) : (
            <Empty style={{ marginTop: 80 }} description="这层还没有房间">
              <Button type="primary" icon={<PlusOutlined />} onClick={onAddRooms}>
                加房间
              </Button>
            </Empty>
          )}
        </div>
        {panel}
      </div>
    </div>
  );
}
