import { useEffect, useMemo, useState } from "react";
import { Alert, App, DatePicker, Input, InputNumber, Modal, Progress, Segmented, Select, Space, Spin } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { session } from "@radar/core";
import { checkIn, getAllBeds, getMembers, type MemberRow } from "../api/member";
import { syncAfter } from "../members/deviceSync";
import { getRoomDesign, radarElements, roomSize, type Room, type RoomDesign } from "../api/room";
import { createFloor, createRoom, type Building, type Floor } from "../api/space";
import { pool } from "../scenes/plan";
import { bedLabel, defaultRoomRange, expandNames, FLOOR_FORMATS, floorLabel, type FloorFormat } from "./names";
import type { Tally } from "./model";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- 删除确认 ----------

/**
 * 删除确认：平台删除是级联的（楼栋 → 楼层 → 房间 → 床位、入住记录，并解绑设备），所以先列出会一起删掉什么。
 * 有人入住时不让删（平台会把入住记录一起删掉），要先办理退住。下面有东西时要输入名字确认。
 */
export function DeleteDialog({
  target,
  onCancel,
  onConfirm,
}: {
  target?: { title: string; name: string; tally: Tally; askName: boolean };
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setTyped(""), [target]);
  if (!target) return null;
  const t = target.tally;
  const devices = t.radars + t.bedDevices;
  const parts = [t.floors && `${t.floors} 个楼层`, t.rooms && `${t.rooms} 间房`, t.beds && `${t.beds} 张床位`].filter(Boolean);
  const blocked = t.occupied.length > 0;
  const nameOk = !target.askName || typed.trim() === target.name;

  return (
    <Modal
      open
      title={target.title}
      okText="删除"
      okButtonProps={{ danger: true, disabled: blocked || !nameOk }}
      confirmLoading={busy}
      onCancel={onCancel}
      onOk={async () => {
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
        }
      }}
      destroyOnHidden
    >
      {blocked ? (
        <Alert
          type="error"
          showIcon
          message={`有 ${t.occupied.length} 位长者住在这里，不能删除`}
          description={
            <>
              {t.occupied
                .slice(0, 8)
                .map((b) => `${b.realName ?? "?"}（${b.bedName}）`)
                .join("、")}
              {t.occupied.length > 8 && ` 等`}
              。平台删除时会把入住记录一起删掉，请先办理退住。
            </>
          }
        />
      ) : (
        <div className="space-delete">
          {parts.length > 0 ? <p>会一起删除：{parts.join("、")}。</p> : <p>下面没有房间和床位。</p>}
          {devices > 0 && <p>会解绑 {devices} 台设备（设备本身保留，可以再绑到别的房间）。</p>}
          <p className="muted">平台上删除后不能恢复。</p>
          {target.askName && (
            <Input placeholder={`输入"${target.name}"确认删除`} value={typed} onChange={(e) => setTyped(e.target.value)} />
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------- 新建楼栋 ----------

/** 新建楼栋：只填名称；建好后页面接着打开"加楼层" */
export function AddBuildingDialog({ open, names, onClose, onCreate }: { open: boolean; names: string[]; onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName("");
  }, [open]);
  const n = name.trim();
  const dup = names.includes(n);

  async function run() {
    if (!n || dup || busy) return;
    setBusy(true);
    try {
      await onCreate(n);
    } catch {
      // 页面已提示，留在对话框里可以改了再试
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="新建楼栋" okText="新建" okButtonProps={{ disabled: !n || dup }} confirmLoading={busy} onOk={run} onCancel={onClose} destroyOnHidden>
      <Input
        autoFocus
        placeholder="楼栋名称，例如 1 号楼"
        maxLength={32}
        value={name}
        status={dup ? "warning" : undefined}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={run}
      />
      <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
        {dup ? "已有同名楼栋" : "建好后接着加楼层"}
      </p>
    </Modal>
  );
}

// ---------- 批量加楼层 ----------

export function AddFloorsDialog({ building, floors, onClose, onDone }: { building?: Building; floors: Floor[]; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const top = floors.reduce((m, f) => Math.max(m, f.floorNumber ?? 0), 0);
  const [from, setFrom] = useState(top + 1);
  const [to, setTo] = useState(top + 1);
  const [fmt, setFmt] = useState<FloorFormat>("F");
  const [busy, setBusy] = useState(false);

  // 打开时：从现有最高层往上加，名称格式跟着这栋楼已有的楼层
  useEffect(() => {
    if (!building) return;
    setFrom(top + 1);
    setTo(top + 1);
    setFmt(floors.some((f) => /层$/.test(f.floorName)) ? "层" : floors.some((f) => /楼$/.test(f.floorName)) ? "楼" : "F");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building]);

  const plan = useMemo(() => {
    const nums = new Set(floors.map((f) => f.floorNumber));
    const names = new Set(floors.map((f) => f.floorName));
    const out: { n: number; name: string; skip?: string }[] = [];
    const [a, b] = from <= to ? [from, to] : [to, from];
    for (let n = a; n <= b && out.length < 100; n++) {
      if (n === 0) continue;
      const name = floorLabel(n, fmt);
      out.push({ n, name, skip: nums.has(n) || names.has(name) ? "已有" : undefined });
    }
    return out;
  }, [floors, from, to, fmt]);
  const todo = plan.filter((p) => !p.skip);

  async function run() {
    if (!building) return;
    setBusy(true);
    let ok = 0;
    try {
      for (const p of todo) {
        await createFloor(building.id, p.name, p.n);
        ok++;
      }
      message.success(`已加 ${ok} 个楼层`);
      onDone();
    } catch (e) {
      message.error(`加到第 ${ok + 1} 个时失败：${errText(e)}`);
      if (ok) onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!building} title={`给 ${building?.buildingName ?? ""} 加楼层`} okText={`加 ${todo.length} 个楼层`} okButtonProps={{ disabled: !todo.length }} confirmLoading={busy} onOk={run} onCancel={onClose} destroyOnHidden>
      <div className="space-form">
        <label>楼层号</label>
        <Space>
          <InputNumber min={-5} max={99} value={from} onChange={(v) => v !== null && setFrom(v)} style={{ width: 80 }} />
          到
          <InputNumber min={-5} max={99} value={to} onChange={(v) => v !== null && setTo(v)} style={{ width: 80 }} />
          <span className="muted small">地下层填负数</span>
        </Space>
        <label>名称</label>
        <Segmented value={fmt} onChange={(v) => setFmt(v as FloorFormat)} options={FLOOR_FORMATS} />
        <label>预览</label>
        <div className="space-preview">
          {plan.map((p) => (
            <span key={p.n} className={p.skip ? "skip" : ""} title={p.skip}>
              {p.name}
            </span>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ---------- 批量加房间 ----------

type Job = { name: string; status: "wait" | "run" | "ok" | "fail"; error?: string };

/**
 * 批量加房间：房号写范围（301-310）或逐个列出，每间几张床、多大；也可以照着已有的一间房布置（家具、区域、雷达位置都拷过去，不拷设备）。
 * 客户端不暴露户型：房间都挂在机构的共用空白户型上。
 */
export function AddRoomsDialog({
  target,
  rooms,
  roomLabel,
  onClose,
  onDone,
}: {
  target?: { building: Building; floor: Floor; existing: Room[] };
  /** 机构里所有房间，用来选"照着哪间布置" */
  rooms: Room[];
  roomLabel: (r: Room) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [names, setNames] = useState("");
  const [beds, setBeds] = useState(1);
  const [width, setWidth] = useState(4);
  const [long, setLong] = useState(4);
  const [copyFrom, setCopyFrom] = useState<string>();
  const [src, setSrc] = useState<{ design?: RoomDesign; loading?: boolean; error?: string }>({});
  const [jobs, setJobs] = useState<Job[]>();

  // 打开时（换了楼层）才重置；建完后列表刷新会换掉 target 对象，不能因此清掉结果
  const floorId = target?.floor.id;
  useEffect(() => {
    if (!target) return;
    setNames(target.existing.length ? "" : defaultRoomRange(target.floor.floorNumber));
    setJobs(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorId]);

  useEffect(() => {
    if (!copyFrom) return setSrc({});
    let alive = true;
    setSrc({ loading: true });
    getRoomDesign(copyFrom).then(
      (design) => alive && setSrc({ design }),
      (e) => alive && setSrc({ error: errText(e) }),
    );
    return () => {
      alive = false;
    };
  }, [copyFrom]);

  const list = useMemo(() => expandNames(names), [names]);
  const have = useMemo(() => new Set(target?.existing.map((r) => r.roomName)), [target]);
  const todo = list.filter((n) => !have.has(n) && n.length <= 32);
  const srcRoom = copyFrom ? rooms.find((r) => r.id === copyFrom) : undefined;
  const srcSize = src.design?.roomStyle ? roomSize(src.design, srcRoom) : undefined;
  const srcRadars = radarElements(src.design).length;
  const srcThings = (src.design?.elements ?? []).filter((e) => e.type !== 3).length;
  const running = jobs?.some((j) => j.status === "wait" || j.status === "run");
  const finished = jobs && !running;

  async function run() {
    if (!target) return;
    const org = session.get()?.orgId ?? "";
    const js: Job[] = todo.map((name) => ({ name, status: "wait" }));
    setJobs(js);
    const set = (i: number, j: Partial<Job>) => setJobs((cur) => cur?.map((x, k) => (k === i ? { ...x, ...j } : x)));
    // 先建第一间（顺便确认共用户型存在），其余 3 个并发
    const one = async (name: string, i: number) => {
      set(i, { status: "run" });
      try {
        await createRoom(org, {
          buildingId: target.building.id,
          floorId: target.floor.id,
          roomName: name,
          width: srcSize ? srcSize.width / 100 : width,
          long: srcSize ? srcSize.height / 100 : long,
          copyFrom: src.design?.roomStyle ? copyFrom : undefined,
          beds: Array.from({ length: beds }, (_, k) => bedLabel(name, k + 1)),
        });
        set(i, { status: "ok" });
      } catch (e) {
        set(i, { status: "fail", error: errText(e) });
      }
    };
    if (todo.length) await one(todo[0]!, 0);
    await pool(todo.slice(1), 3, (name, i) => one(name, i + 1));
    onDone();
  }

  const done = jobs?.filter((j) => j.status === "ok").length ?? 0;
  const failed = jobs?.filter((j) => j.status === "fail") ?? [];

  return (
    <Modal
      open={!!target}
      width={560}
      title={target ? `在 ${target.building.buildingName} › ${target.floor.floorName} 加房间` : ""}
      okText={finished ? "完成" : `建 ${todo.length} 间房${beds ? `、${todo.length * beds} 张床` : ""}`}
      okButtonProps={{ disabled: !finished && (!todo.length || src.loading || running) }}
      cancelButtonProps={{ disabled: running, style: finished ? { display: "none" } : undefined }}
      confirmLoading={running}
      closable={!running}
      maskClosable={!running}
      onOk={finished ? onClose : run}
      onCancel={() => !running && onClose()}
      destroyOnHidden
    >
      {jobs ? (
        <div className="space-form">
          <Progress className="space-span" percent={Math.round(((done + failed.length) / Math.max(1, jobs.length)) * 100)} success={{ percent: Math.round((done / Math.max(1, jobs.length)) * 100) }} />
          <div className="muted space-span">
            已建 {done} / {jobs.length} 间{failed.length > 0 && `，${failed.length} 间失败`}
          </div>
          {failed.length > 0 && (
            <Alert
              className="space-span"
              type="error"
              message="这些房间没建成"
              description={
                <ul className="space-fails">
                  {failed.map((j) => (
                    <li key={j.name}>
                      <b>{j.name}</b>：{j.error}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
        </div>
      ) : (
        <div className="space-form">
          <label>房间名</label>
          <div>
            <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} placeholder="301-310，或者 301 302 活动室" value={names} onChange={(e) => setNames(e.target.value)} autoFocus />
            <div className="muted small">范围用"-"，多个用空格或逗号分开</div>
          </div>
          <label>每间床位</label>
          <Space>
            <InputNumber min={0} max={20} value={beds} onChange={(v) => v !== null && setBeds(v)} style={{ width: 80 }} />
            <span className="muted small">{beds > 0 && list[0] ? `床位名如 ${bedLabel(list[0], 1)}` : "先不建床位"}</span>
          </Space>
          <label>布置</label>
          <Select
            allowClear
            showSearch
            placeholder="空白房间"
            value={copyFrom}
            onChange={setCopyFrom}
            optionFilterProp="label"
            options={rooms.map((r) => ({ value: r.id, label: `照着 ${roomLabel(r)}` }))}
          />
          <label>尺寸</label>
          {copyFrom ? (
            <div className="muted">
              {src.loading ? (
                <Spin size="small" />
              ) : src.error ? (
                <span className="err-text">布置读不到：{src.error}</span>
              ) : srcSize ? (
                <>
                  {srcSize.width / 100} × {srcSize.height / 100} m，跟着这间房；拷过去{[srcThings > 0 && `${srcThings} 件家具`, srcRadars > 0 && `${srcRadars} 个雷达位置和区域（不拷设备）`].filter(Boolean).join("、") || "空白布置"}
                </>
              ) : (
                "这间房还没有布置，会建成空白房间"
              )}
            </div>
          ) : (
            <Space>
              宽
              <InputNumber min={1} max={50} step={0.1} value={width} onChange={(v) => v !== null && setWidth(v)} style={{ width: 80 }} />
              长
              <InputNumber min={1} max={50} step={0.1} value={long} onChange={(v) => v !== null && setLong(v)} style={{ width: 80 }} />
              <span className="muted small">米</span>
            </Space>
          )}
          <label>预览</label>
          <div className="space-preview">
            {list.length === 0 && <span className="muted">还没填房间名</span>}
            {list.slice(0, 120).map((n) => (
              <span key={n} className={have.has(n) || n.length > 32 ? "skip" : ""} title={have.has(n) ? "这层已经有了，跳过" : n.length > 32 ? "超过 32 个字" : undefined}>
                {n}
              </span>
            ))}
            {list.length > 120 && <span className="muted">… 共 {list.length} 间</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------- 从床位办入住 ----------

/** 空床上直接办入住：选一位还没入住的长者（入住状态以床位一侧为准，打开时现取长者和床位） */
export function BedCheckInDialog({ bed, place, onClose, onDone }: { bed?: { id: string; bedName: string }; place: string; onClose: () => void; onDone: (realName: string) => void }) {
  const { message } = App.useApp();
  const [list, setList] = useState<MemberRow[]>();
  const [memberId, setMemberId] = useState<string>();
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bed) return;
    setMemberId(undefined);
    setDate(dayjs());
    setList(undefined);
    let alive = true;
    Promise.all([getMembers(), getAllBeds()]).then(
      ([ms, bs]) => {
        if (!alive) return;
        const housed = new Set(bs.map((b) => b.memberId).filter(Boolean));
        // 平台记着已入住（checkType 2）的长者即使床上没有他也办不了入住，先排除
        setList(ms.filter((m) => !housed.has(m.id) && m.checkType !== 2).sort((a, b) => a.realName.localeCompare(b.realName, "zh-CN")));
      },
      (e) => alive && message.error(`读取长者失败：${errText(e)}`),
    );
    return () => {
      alive = false;
    };
  }, [bed, message]);

  async function run() {
    if (!bed || !memberId) return;
    setBusy(true);
    try {
      await checkIn(memberId, bed.id, date.format("YYYY-MM-DD"));
      message.success("已办理入住");
      await syncAfter(message, { bedIds: [bed.id] });
      onDone(list?.find((m) => m.id === memberId)?.realName ?? "");
    } catch (e) {
      message.error(`入住失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!bed} title={`办理入住：${place} › ${bed?.bedName ?? ""}`} okText="入住" okButtonProps={{ disabled: !memberId }} confirmLoading={busy} onOk={run} onCancel={onClose} destroyOnHidden>
      <div className="space-form">
        <label>长者</label>
        <Select
          showSearch
          autoFocus
          loading={!list}
          optionFilterProp="label"
          placeholder="选一位还没入住的长者"
          value={memberId}
          onChange={setMemberId}
          notFoundContent={list ? "没有未入住的长者，先到长者页新建" : <Spin size="small" />}
          options={list?.map((m) => ({ value: m.id, label: [m.realName, m.age ? `${m.age} 岁` : "", m.phoneNumber].filter(Boolean).join(" · ") }))}
        />
        <label>入住日期</label>
        <DatePicker value={date} onChange={(d) => d && setDate(d)} allowClear={false} />
      </div>
    </Modal>
  );
}
