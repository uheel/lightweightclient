import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Dropdown, Empty, InputNumber, Spin } from "antd";
import { DeleteOutlined, HomeOutlined, MoreOutlined, PictureOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { perfTimer } from "@radar/core";
import { getClientAssets, setBuildingImage, type ClientAssets } from "../api/clientAssets";
import { bindBedDevice, getRadars, getRoomDevices, unbindBedKeepRoom, type RoomDevice } from "../api/device";
import { compressImage, deleteFile, fileUrl, IMAGE_ACCEPT, uploadFile } from "../api/files";
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
import { AddBuildingDialog, AddFloorsDialog, AddRoomsDialog, BedCheckInDialog, DeleteDialog } from "../spaces/dialogs";
import { indexSpaces, roomsOfBuilding, roomsOfFloor, tallyRooms, without, type Spaces, type Tally } from "../spaces/model";
import { nextBedName } from "../spaces/names";
import { useGuide, useGuideFocus } from "../guide/GuideContext";
import { GuideEmpty } from "../guide/GuideEmpty";
import { flashSpot } from "../guide/flash";
import { syncAfter } from "../members/deviceSync";
import { ModuleName } from "../workspace/ModuleName";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const EMPTY: Spaces = { buildings: [], floors: [], rooms: [], beds: [], radars: [] };
const occupied = (b: BedRow) => b.bedStatus === 2 || !!b.realName;

type Sel = { kind: "building" | "floor"; id: string };
type DeleteTarget = { title: string; name: string; tally: Tally; askName: boolean; run: () => Promise<void> };

/**
 * 楼宇：楼栋 / 楼层 / 房间 / 床位的基础资料。逐级进入：楼栋卡片 → 点进楼栋是楼层卡片 → 点进楼层是房间格子，点房间在右侧改名、改尺寸、管床位。
 * 顶部面包屑回到上一级。
 * 没有户型：房间挂在机构的共用空白户型上，批量建房时可以照着一间已有的房间布置。
 * 进页面一次取回楼栋、楼层、房间、床位和雷达，之后分组、统计、删除前的影响范围都在本地算；改名、删除只改本地数据，新建后静默刷新一次。
 */
export default function SpacesPage() {
  const { message } = App.useApp();
  const [data, setData] = useState<Spaces>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Sel>();
  const [roomId, setRoomId] = useState<string>();
  const [addingBuilding, setAddingBuilding] = useState(false);
  const [floorsFor, setFloorsFor] = useState<Building>();
  const [roomsFor, setRoomsFor] = useState<{ building: Building; floor: Floor }>();
  const [del, setDel] = useState<DeleteTarget>();
  const [checkInBed, setCheckInBed] = useState<BedRow>();
  /** 选中房间里的设备和它们绑的床位（只有床位绑定要单独取） */
  const [roomDevices, setRoomDevices] = useState<{ roomId: string; list: RoomDevice[] }>();
  /** 楼栋 id → 图片文件 id（客户端自己存的，平台楼栋上没有图片字段） */
  const [images, setImages] = useState<Record<string, string>>({});
  /** 正在上传图片的楼栋 */
  const [uploading, setUploading] = useState<string>();
  const seq = useRef(0);
  const guide = useGuide();
  const guideRefresh = useRef(guide?.refresh);
  guideRefresh.current = guide?.refresh;

  const load = useCallback(
    async (quiet = false) => {
      const my = ++seq.current;
      if (!quiet) setLoading(true);
      const pt = perfTimer("楼宇");
      try {
        // 楼栋图取不到不影响页面，退回示意图
        const [s, radars, assets] = await Promise.all([getSpaces(), getRadars(), getClientAssets().catch((): ClientAssets => ({}))]);
        if (my !== seq.current) return;
        setData({ ...s, radars });
        setImages(assets.buildings ?? {});
        // 新建之后的静默刷新：快速开始清单跟着重新检查
        if (quiet) guideRefresh.current?.(true);
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

  // 进去的楼栋 / 楼层没了（刷新后被别人删掉）：回到楼栋列表
  useEffect(() => {
    if (loading || !sel) return;
    if (!(sel.kind === "floor" ? ix.floor.has(sel.id) : ix.building.has(sel.id))) setSel(undefined);
  }, [ix, sel, loading]);

  useEffect(() => {
    if (roomId && !ix.room.has(roomId)) setRoomId(undefined);
  }, [ix, roomId]);

  // 从快速开始清单跳过来：选中那间房所在的楼层并打开房间（页面可能还在加载，等数据到了再选）；要看床位时闪一下床位
  const [focusRoom, setFocusRoom] = useState<{ id: string; beds: boolean }>();
  useGuideFocus("spaces", (f) => f.id && setFocusRoom({ id: f.id, beds: f.spot === "beds" }));
  useEffect(() => {
    const r = focusRoom ? ix.room.get(focusRoom.id) : undefined;
    if (!r) return;
    setFocusRoom(undefined);
    if (r.floorId) setSel({ kind: "floor", id: r.floorId });
    setRoomId(r.id);
    if (focusRoom!.beds) flashSpot([`[data-spot="beds"][data-room="${r.id}"]`]);
  }, [focusRoom, ix]);

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

  function pick(s: Sel | undefined) {
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

  async function addBuilding(name: string) {
    const id = await act("新建楼栋", () => createBuilding(name));
    const b: Building = { id, buildingName: name };
    setData((d) => ({ ...d, buildings: [...d.buildings, b] }));
    setAddingBuilding(false);
    pick({ kind: "building", id });
    // 新楼栋紧接着加楼层
    setFloorsFor(b);
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
        pick(undefined);
        setData((d) => without(d, { buildings: [b.id] }));
        if (images[b.id]) removeImage(b, true);
      },
    });
  }

  /** 选一张图压缩后上传，改对应关系，再删掉换下来的旧文件 */
  function pickImage(b: Building) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_ACCEPT;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(b.id);
      try {
        const id = await uploadFile(await compressImage(file), `楼栋-${b.buildingName}.webp`);
        const { next, old } = await setBuildingImage(b.id, id);
        setImages(next.buildings ?? {});
        if (old) deleteFile(old);
      } catch (e) {
        message.error(`上传图片失败：${errText(e)}`);
      } finally {
        setUploading(undefined);
      }
    };
    input.click();
  }

  async function removeImage(b: Building, quiet = false) {
    try {
      const { next, old } = await setBuildingImage(b.id, undefined);
      setImages(next.buildings ?? {});
      if (old) deleteFile(old);
    } catch (e) {
      if (!quiet) message.error(`去掉图片失败：${errText(e)}`);
    }
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
        pick({ kind: "building", id: f.buildingId });
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
    await syncAfter(message, { roomIds: [r.id] });
  }

  /** 平台解绑床位会连房间绑定一起清掉，解绑后再绑回本房间 */
  async function onUnbindBedDevice(r: Room, b: BedRow, dev: RoomDevice) {
    await act("解绑", () => unbindBedKeepRoom(b.id, r.id, dev.deviceId));
    setData((d) => ({ ...d, beds: d.beds.map((x) => (x.id === b.id ? { ...x, deviceCount: Math.max(0, (x.deviceCount ?? 1) - 1) } : x)) }));
    await loadRoomDevices(r.id);
    await syncAfter(message, { roomIds: [r.id] });
  }

  async function onDeleteBed(b: BedRow) {
    await act("删除床位", () => deleteBed(b));
    setData((d) => without(d, { beds: [b.id] }));
  }

  // ---------- 渲染 ----------

  const allBeds = data.beds.length;
  const floorTally = (f: Floor) => tallyRooms(ix, roomsOfFloor(ix, f.id));

  const buildingTally = (b: Building) => tallyRooms(ix, roomsOfBuilding(ix, b.id), ix.floorsOf.get(b.id)?.length ?? 0);
  const toList = () => pick(undefined);

  return (
    <div className="space-page">
      <section className="space-main">
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
            onPickList={toList}
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
            key={curBuilding.id}
            building={curBuilding}
            floors={ix.floorsOf.get(curBuilding.id) ?? []}
            floorTally={floorTally}
            onPickList={toList}
            onPickFloor={(id) => pick({ kind: "floor", id })}
            onRename={onRenameBuilding(curBuilding)}
            onAddFloors={() => setFloorsFor(curBuilding)}
            onDelete={() => askDeleteBuilding(curBuilding)}
          />
        ) : (
          <BuildingsView
            buildings={ix.buildings}
            loading={loading}
            total={{ rooms: data.rooms.length, beds: allBeds }}
            tally={buildingTally}
            onPick={(id) => pick({ kind: "building", id })}
            onAdd={() => setAddingBuilding(true)}
            onRefresh={() => load()}
            onDelete={askDeleteBuilding}
            images={images}
            uploading={uploading}
            onPickImage={pickImage}
            onRemoveImage={removeImage}
          />
        )}
      </section>

      <AddBuildingDialog open={addingBuilding} names={data.buildings.map((b) => b.buildingName)} onClose={() => setAddingBuilding(false)} onCreate={addBuilding} />
      <AddFloorsDialog
        building={floorsFor}
        floors={floorsFor ? ix.floorsOf.get(floorsFor.id) ?? [] : []}
        onClose={() => setFloorsFor(undefined)}
        onDone={() => {
          const b = floorsFor;
          setFloorsFor(undefined);
          if (b) pick({ kind: "building", id: b.id });
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

/** 顶部面包屑：前面几级可以点回去 */
function Crumbs({ items }: { items: { label: string; onClick: () => void }[] }) {
  return (
    <>
      {items.map((x, i) => (
        <button key={i} className="space-crumb" onClick={x.onClick}>
          {x.label} ›
        </button>
      ))}
    </>
  );
}

/** 入住进度条：已住 / 床位 */
function Occupancy({ t }: { t: Tally }) {
  const pct = t.beds ? Math.round((t.occupied.length / t.beds) * 100) : 0;
  return (
    <span className="space-occ" title={`${t.occupied.length} / ${t.beds} 床已入住`}>
      <span className="space-occ-bar">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="muted small">{t.beds ? `入住 ${t.occupied.length}/${t.beds}` : "没有床位"}</span>
    </span>
  );
}

/** 楼栋卡片上的示意图：按楼层数画几层窗户（最多 8 层） */
function BuildingArt({ floors }: { floors: number }) {
  const n = Math.max(1, Math.min(floors, 8));
  const h = 9;
  const top = 80 - n * h;
  return (
    <svg className="space-art" viewBox="0 0 160 84" aria-hidden="true">
      <rect x="48" y={top - 6} width="64" height={n * h + 6} rx="3" />
      {Array.from({ length: n }, (_, i) =>
        [0, 1, 2, 3].map((j) => <rect key={`${i}-${j}`} className="win" x={55 + j * 14} y={top + i * h} width="8" height="5" rx="1" />),
      )}
      <line x1="24" x2="136" y1="80" y2="80" />
    </svg>
  );
}

/** 第一级：楼栋卡片 */
function BuildingsView({
  buildings,
  loading,
  total,
  tally,
  onPick,
  onAdd,
  onRefresh,
  onDelete,
  images,
  uploading,
  onPickImage,
  onRemoveImage,
}: {
  buildings: Building[];
  loading: boolean;
  total: { rooms: number; beds: number };
  tally: (b: Building) => Tally;
  onPick: (id: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
  onDelete: (b: Building) => void;
  images: Record<string, string>;
  uploading?: string;
  onPickImage: (b: Building) => void;
  onRemoveImage: (b: Building) => void;
}) {
  // 图片被别人在平台文件管理里删掉了（404）：这一页里退回示意图
  const [broken, setBroken] = useState<Set<string>>(new Set());
  return (
    <div className="space-view">
      <div className="space-head">
        <span className="space-title"><ModuleName k="spaces" /></span>
        <span className="muted small">
          {buildings.length} 栋 · {total.rooms} 间 · {total.beds} 床
        </span>
        <span className="grow" />
        <Button type="text" icon={<ReloadOutlined />} onClick={onRefresh} title="刷新" />
        <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
          新建楼栋
        </Button>
      </div>
      <div className="space-scroll">
        {loading && !buildings.length ? (
          <Spin style={{ display: "block", margin: 80 }} />
        ) : buildings.length ? (
          <div className="space-cards">
            {buildings.map((b) => {
              const t = tally(b);
              const img = images[b.id];
              const shown = img && !broken.has(img) ? img : undefined;
              return (
                <div key={b.id} className="space-card" role="button" tabIndex={0} onClick={() => onPick(b.id)} onKeyDown={(e) => e.key === "Enter" && onPick(b.id)}>
                  <div className="space-card-art">
                    {shown ? (
                      <img className="space-card-photo" src={fileUrl(shown, 800)} alt="" draggable={false} onError={() => setBroken((s) => new Set(s).add(shown))} />
                    ) : (
                      <BuildingArt floors={t.floors} />
                    )}
                    {uploading === b.id && <Spin className="space-card-busy" />}
                    <span onClick={(e) => e.stopPropagation()}>
                      <Dropdown
                        menu={{
                          items: [
                            { key: "img", label: img ? "更换图片" : "上传图片", icon: <PictureOutlined />, disabled: uploading === b.id, onClick: () => onPickImage(b) },
                            ...(img ? [{ key: "noimg", label: "去掉图片", onClick: () => onRemoveImage(b) }] : []),
                            { type: "divider" as const },
                            { key: "del", label: "删除楼栋", danger: true, icon: <DeleteOutlined />, onClick: () => onDelete(b) },
                          ],
                        }}
                        trigger={["click"]}
                      >
                        <Button className="space-card-more" size="small" type="text" icon={<MoreOutlined />} />
                      </Dropdown>
                    </span>
                  </div>
                  <div className="space-card-body">
                    <b>{b.buildingName}</b>
                    <span className="muted small">
                      {t.floors} 层 · {t.rooms} 间 · {t.beds} 床{t.radars ? ` · ${t.radars} 台雷达` : ""}
                    </span>
                    <Occupancy t={t} />
                  </div>
                </div>
              );
            })}
            <button className="space-card add" onClick={onAdd}>
              <PlusOutlined /> 新建楼栋
            </button>
          </div>
        ) : (
          <GuideEmpty
            icon={<HomeOutlined />}
            title="先建一栋楼"
            desc="雷达、床位、长者都挂在房间上。顺序是：新建楼栋 → 批量加楼层 → 批量加房间（写 301-310 这样的范围，每间可以带几张床）。"
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
              新建楼栋
            </Button>
          </GuideEmpty>
        )}
      </div>
    </div>
  );
}

/** 第二级：楼栋里的楼层卡片（高层在前） */
function BuildingView({
  building,
  floors,
  floorTally,
  onPickList,
  onPickFloor,
  onRename,
  onAddFloors,
  onDelete,
}: {
  building: Building;
  floors: Floor[];
  floorTally: (f: Floor) => Tally;
  onPickList: () => void;
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
        <Crumbs items={[{ label: "楼宇", onClick: onPickList }]} />
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
      <div className="space-scroll">
        {floors.length ? (
          <div className="space-cards floors">
            {[...floors].reverse().map((f, i) => {
              const t = ts[floors.length - 1 - i]!;
              return (
                <button key={f.id} className="space-card floor" onClick={() => onPickFloor(f.id)}>
                  <span className="space-floor-no">{f.floorNumber ?? "–"}</span>
                  <span className="space-card-body">
                    <b>{f.floorName}</b>
                    <span className="muted small">
                      {t.rooms} 间 · {t.beds} 床{t.radars ? ` · ${t.radars} 台雷达` : ""}
                    </span>
                    <Occupancy t={t} />
                  </span>
                </button>
              );
            })}
            <button className="space-card floor add" onClick={onAddFloors}>
              <PlusOutlined /> 加楼层
            </button>
          </div>
        ) : (
          <Empty style={{ marginTop: 80 }} description="这栋楼还没有楼层">
            <Button type="primary" icon={<PlusOutlined />} onClick={onAddFloors}>
              加楼层
            </Button>
          </Empty>
        )}
      </div>
    </div>
  );
}

/** 第三级：楼层里的房间格子 + 选中房间的面板 */
function FloorView({
  building,
  floor,
  rooms,
  bedsOf,
  radarsOf,
  tally,
  selRoom,
  onPickRoom,
  onPickList,
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
  onPickList: () => void;
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
        <Crumbs
          items={[
            { label: "楼宇", onClick: onPickList },
            { label: building.buildingName, onClick: onPickBuilding },
          ]}
        />
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
