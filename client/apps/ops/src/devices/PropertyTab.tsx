import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Select, Space, Spin, Switch, Tooltip } from "antd";
import { CloudDownloadOutlined, CloudUploadOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { realtime, type RealtimeState } from "@radar/core";
import {
  getPropertySchema,
  getStoredProperties,
  isResponseOk,
  readDeviceProperties,
  writeDeviceProperties,
  type DeviceResponse,
  type PropertyDef,
  type PropertySchema,
  type StoredProperty,
} from "../api/device";
import { structuredFor, PLAN_CTX, type PlanCtx, type ZoneMeta } from "./propertyEditors";
import { syncLayoutFromDevice } from "../rooms/syncLayout";
import { sameArray, toDeviceArrays, validate, type QlConfig } from "../rooms/qinglan";
import { GROUP_TEXT, PROPERTY_TEXT } from "./propertyInfo";

/**
 * 设备属性：读取设备上的当前值、修改后下发（与平台"设备配置 › 存储属性"同一套接口）。
 * 读取 / 下发都是异步的：接口先返回 seq，设备应答从实时推送 DeviceResponse 回来，30 秒收不到算超时。
 * 同一时间只等一条指令。
 */

const TIMEOUT_MS = 30_000;
/** 设备应答"正忙"：刚应用完上一条设置时会拒绝新的设置 */
const BUSY = 103;
const BUSY_RETRY_MS = 10_000;
const UNGROUPED = "__ungrouped";
const GROUP_KEY = "ops:prop-group";

/** 通话相关的属性：都在"通话"页改（CallTab），设备属性里不显示 */
const CALL_PROPS = new Set([
  "talk_type_sel",
  "talk_master_number",
  "talk_call_number_bak",
  "talk_key1_number",
  "talk_key2_number",
  "talk_key3_number",
  "talk_local_maxtime",
  "talk_call_timeout",
  "call_record_EN",
  "call_record_url",
  "sip_account",
  "sip_password",
  "sip_server",
]);
const SECRET = /pass|pwd|token/i;

type Command = "get-property" | "set-property";

interface Pending {
  command: Command;
  names: string[];
  seq?: string;
  /** seq 还没回来时先到的应答 */
  buffer: DeviceResponse[];
  timer: number;
  off: () => void;
}

/** 从设备读到（或下发成功）的值 */
interface DeviceValue {
  value: unknown;
  at: number;
  how: "read" | "write";
  /** 读取前的平台记录（平台会把读到的值存成新的平台记录，所以要在读取前留一份来比较） */
  before?: unknown;
}

type Delivery = { status: "pending" } | { status: "ok"; at: number } | { status: "error" | "timeout"; at: number; error?: string };

const readOnly = (p: PropertyDef) => p.accessMode === 2 || p.displayType === 1 || p.displayType === 8;
/** 能从设备读：不是平台属性，也不是只写 */
const readable = (p: PropertyDef) => !p.isPlatformOnly && p.accessMode !== 3;
const nameOf = (p: PropertyDef) => PROPERTY_TEXT[p.propertyName]?.name ?? p.title;
const descOf = (p: PropertyDef) => PROPERTY_TEXT[p.propertyName]?.desc;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 平台的显示条件，例如 `talk_type_sel===1`、`offlsr_response_file==="x.wav"`，支持 && 和 || */
function visibleBy(expr: string | undefined, ctx: Record<string, unknown>) {
  if (!expr) return true;
  const term = (t: string) => {
    const m = t.trim().match(/^\(?\s*([\w.-]+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+?)\s*\)?$/);
    if (!m) return true;
    const left = ctx[m[1]];
    let right: unknown = m[3];
    if (/^(["']).*\1$/.test(m[3])) right = m[3].slice(1, -1);
    else if (m[3] === "true" || m[3] === "false") right = m[3] === "true";
    else if (m[3] !== "" && !Number.isNaN(Number(m[3]))) right = Number(m[3]);
    switch (m[2]) {
      case "===":
      case "==":
        return String(left) === String(right);
      case "!==":
      case "!=":
        return String(left) !== String(right);
      case ">=":
        return Number(left) >= Number(right);
      case "<=":
        return Number(left) <= Number(right);
      case ">":
        return Number(left) > Number(right);
      default:
        return Number(left) < Number(right);
    }
  };
  return expr.split("||").some((or) => or.split("&&").every(term));
}

function format(p: PropertyDef, v: unknown, typeCode?: number): string {
  if (SECRET.test(p.propertyName) && v !== undefined && v !== null && v !== "") return "••••••";
  const st = structuredFor(p, typeCode);
  if (st) return st.summary(v);
  if (v === undefined || v === null || v === "") return "—";
  const fp = p.fieldProps ?? {};
  if (p.displayType === 7 && fp.multiple && Array.isArray(v))
    return [...new Set(v)].map((x) => fp.options?.find((o) => String(o.value) === String(x))?.label ?? String(x)).join("、") || "—";
  if (p.displayType === 5) return same(v, fp.openValue ?? 1) ? "开" : same(v, fp.closeValue ?? 0) ? "关" : String(v);
  if (p.displayType === 7) return fp.options?.find((o) => String(o.value) === String(v))?.label ?? String(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v) + (p.unit ? ` ${p.unit}` : "");
}

export default function PropertyTab({
  sn,
  online,
  plan,
  roomId,
  layout,
  onLayoutSynced,
  focusProp,
  onGoCall,
}: {
  sn: string;
  /** 通话配置分组里提示去"通话"页（能通话的型号才传） */
  onGoCall?: () => void;
  /** 从快速开始跳过来：切到这个属性所在的分组（不记成下次默认的分组） */
  focusProp?: { name: string; seq: number };
  online: boolean;
  /** 设备所在房间：下发安装配置 / 区域后写回这个房间的布置 */
  roomId?: string;
  /** 房间布置里这台雷达的朝向和房间外框，区域画布按房间平面图的方向画 */
  plan?: Omit<PlanCtx, "deviceType">;
  /** 写回房间布置之后（让外面重新取房间信息） */
  onLayoutSynced?: () => void;
  /** 房间布置里这台雷达的配置：可以按它整份下发（布置刚从户型拷来、平台记录已经一样时，普通"改了才下发"发不出去） */
  layout?: QlConfig;
}) {
  const { message, modal, notification } = App.useApp();
  const [schema, setSchema] = useState<PropertySchema>();
  const [loadError, setLoadError] = useState<string>();
  const [group, setGroup] = useState<string>();
  const [stored, setStored] = useState<Record<string, StoredProperty>>({});
  const [device, setDevice] = useState<Record<string, DeviceValue>>({});
  /** 本地改过的值 */
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  /** JSON 输入框里解析不了的内容 */
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [delivery, setDelivery] = useState<Record<string, Delivery>>({});
  /** 最近一次读取时设备没有返回的属性（固件不支持） */
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Command>();
  /** 撤销、读取后让 JSON 输入框按新值重建 */
  const [rev, setRev] = useState(0);
  const [rtState, setRtState] = useState<RealtimeState>(realtime.state);
  const pending = useRef<Pending>(undefined);
  /** 这次下发已经因为设备忙（code 103）自动重发过一次 */
  const retried = useRef(false);
  /** 按房间布置下发时直接给的值（不经过 edits），重发和应答时都用它 */
  const forced = useRef<Record<string, unknown>>(undefined);
  /** 还没下发的房间布置改动（顶装 / 侧装互换后的朝向、雷达位置） */
  const [planEdit, setPlanEdit] = useState<Partial<PlanCtx>>();
  const planEditRef = useRef(planEdit);
  planEditRef.current = planEdit;
  const setPlan = (x: Partial<PlanCtx>) => setPlanEdit((cur) => ({ ...cur, ...x }));

  useEffect(() => realtime.onState((s) => setRtState(s)), []);

  const focusSeen = useRef(0);
  useEffect(() => {
    if (!schema || !focusProp || focusProp.seq === focusSeen.current) return;
    const p = schema.properties.find((x) => x.propertyName === focusProp.name);
    if (!p) return;
    focusSeen.current = focusProp.seq;
    setGroup(p.propertyGroupStringCode && groupsOf(schema).some((g) => g.value === p.propertyGroupStringCode) ? p.propertyGroupStringCode : UNGROUPED);
  }, [schema, focusProp]);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      const s = await getPropertySchema(sn);
      setSchema(s);
      setStored(s.values);
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(GROUP_KEY);
      } catch {
        /* 读不到就用第一组 */
      }
      const codes = groupsOf(s).map((g) => g.value);
      setGroup((cur) => (cur && codes.includes(cur) ? cur : saved && codes.includes(saved) ? saved : codes[0]));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [sn]);

  // 换设备：清掉上一台的状态和等待中的指令
  useEffect(() => {
    setSchema(undefined);
    setStored({});
    setDevice({});
    setEdits({});
    setErrors({});
    setDelivery({});
    setMissing(new Set());
    load();
    return () => void finish(pending.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sn]);

  /** 报文键（别名）→ 属性名 */
  const byKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of schema?.properties ?? []) {
      m.set(p.propertyName, p.propertyName);
      if (p.aliasName) m.set(p.aliasName, p.propertyName);
    }
    return m;
  }, [schema]);

  const typeCode = schema?.deviceTypeCode;
  const base = (name: string) => (name in device ? device[name].value : stored[name]?.value);
  const valueOf = (name: string) => (name in edits ? edits[name] : base(name));
  const isModified = (name: string) => name in edits && !same(edits[name], base(name));

  const ctx = useMemo(() => {
    const c: Record<string, unknown> = {};
    for (const p of schema?.properties ?? []) c[p.propertyName] = p.propertyName in edits ? edits[p.propertyName] : base(p.propertyName);
    c[PLAN_CTX] = { ...plan, ...planEdit, deviceType: schema?.deviceTypeCode, roomBound: !!roomId } satisfies PlanCtx;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, stored, device, edits, plan, planEdit, roomId]);

  const visible = (p: PropertyDef) => visibleBy(p.fieldProps?.visibleExpression, ctx);
  const changed = (schema?.properties ?? []).filter((p) => !readOnly(p) && !p.isBuiltIn && visible(p) && isModified(p.propertyName));
  const groups = schema ? groupsOf(schema) : [];
  const inGroup = (schema?.properties ?? []).filter((p) => (group === UNGROUPED ? !p.propertyGroupStringCode : p.propertyGroupStringCode === group));
  // 通话相关的属性只在"通话"页改，这里不显示，免得两处都能改
  const rows = inGroup.filter((p) => !CALL_PROPS.has(p.propertyName)).filter(visible);
  const hasCallProps = inGroup.some((p) => CALL_PROPS.has(p.propertyName));

  function setValue(name: string, v: unknown) {
    setEdits((e) => ({ ...e, [name]: v }));
    setDelivery((d) => {
      if (!d[name] || d[name].status === "pending") return d;
      const { [name]: _, ...rest } = d;
      return rest;
    });
  }

  function setError(name: string, err?: string) {
    setErrors((e) => {
      if (!err) {
        const { [name]: _, ...rest } = e;
        return rest;
      }
      return { ...e, [name]: err };
    });
  }

  // ---------- 指令与应答 ----------

  function finish(p?: Pending) {
    if (!p || pending.current !== p) return false;
    pending.current = undefined;
    clearTimeout(p.timer);
    p.off();
    setBusy(undefined);
    return true;
  }

  function begin(command: Command, names: string[]) {
    if (pending.current) {
      message.warning("上一条指令还在等设备应答，请稍后再试");
      return;
    }
    const p: Pending = { command, names, buffer: [], timer: 0, off: () => {} };
    p.off = realtime.on("DeviceResponse", (payload) => {
      const r = payload as DeviceResponse;
      if (pending.current !== p || r?.sn !== sn || r.command !== command) return;
      if (p.seq === undefined) p.buffer.push(r);
      else if (String(r.seq) === p.seq) complete(p, r);
    });
    p.timer = window.setTimeout(() => {
      if (!finish(p)) return;
      if (command === "set-property") {
        forced.current = undefined;
        markDelivery(p.names, { status: "timeout", at: Date.now() });
        refreshStored();
      }
      notification.warning({
        message: command === "get-property" ? "读取设备属性" : "下发设备属性",
        description: "30 秒内没有收到设备应答。请确认设备在线；下发的结果可以在通信日志里查看。",
      });
    }, TIMEOUT_MS);
    pending.current = p;
    setBusy(command);
    return p;
  }

  /** 接口返回 seq 后，检查是否已有先到的应答 */
  function gotSeq(p: Pending, seq: unknown) {
    p.seq = String(seq);
    const hit = p.buffer.find((r) => String(r.seq) === p.seq);
    if (hit) complete(p, hit);
  }

  function complete(p: Pending, r: DeviceResponse) {
    if (!finish(p)) return;
    const ok = isResponseOk(r.code);
    if (p.command === "get-property") {
      if (ok) {
        applyRead(p.names, (r.data ?? {}) as Record<string, unknown>);
      } else {
        notification.error({ message: "读取设备属性失败", description: `${r.message ?? ""}（code ${r.code}）`, duration: 10 });
      }
      return;
    }
    const now = Date.now();
    if (ok) {
      markDelivery(p.names, { status: "ok", at: now });
      // 设备上的值已经是下发的值
      const written: Record<string, unknown> = {};
      const fromLayout = forced.current;
      for (const n of p.names) written[n] = fromLayout ? fromLayout[n] : editsRef.current[n];
      forced.current = undefined;
      applyDevice(written, "write");
      message.success(fromLayout ? "设备已按房间布置更新安装配置和区域" : "设备已接收下发的属性");
      const pe = planEditRef.current;
      setPlanEdit(undefined);
      // 按布置下发时布置本身就是来源，不用写回
      if (roomId && !fromLayout && ("QL_radar_area" in written || "QL_radar_config" in written)) {
        const mount = pe?.facing !== undefined ? { facing: pe.facing, radar: pe.room?.radar } : undefined;
        syncLayoutFromDevice(roomId, sn, { config: written.QL_radar_config, area: written.QL_radar_area }, mount, pe?.zones).then(
          (res) => {
            if (res.changed) {
              message.success("已同步到房间布置，平台的房间图也会跟着变");
              onLayoutSynced?.();
            } else if (res.note) notification.warning({ message: "房间布置没有同步", description: res.note, duration: 10 });
          },
          (e) => notification.error({ message: "同步房间布置失败", description: e instanceof Error ? e.message : String(e), duration: 10 }),
        );
      }
    } else if (r.code === BUSY && !retried.current) {
      // 设备刚应用完上一条设置的几秒内会拒绝新的设置（2026-10-17 在 13 型上实测），隔一会儿重发就行
      retried.current = true;
      markDelivery(p.names, { status: "pending" });
      message.info(`设备还在应用上一条设置，${BUSY_RETRY_MS / 1000} 秒后自动重发`);
      const defs = (schema?.properties ?? []).filter((d) => p.names.includes(d.propertyName));
      window.setTimeout(() => doWriteRef.current(defs, false, true), BUSY_RETRY_MS);
      return;
    } else {
      const busy = r.code === BUSY;
      forced.current = undefined;
      markDelivery(p.names, { status: "error", at: now, error: busy ? "设备一直在忙，没有接受（code 103），请过一会儿再下发" : `${r.message ?? "下发失败"}（code ${r.code}）` });
      notification.error({ message: "下发设备属性失败", description: busy ? "设备一直在忙，没有接受这次设置（code 103）。请过一会儿再下发。" : `${r.message ?? ""}（code ${r.code}）`, duration: 10 });
    }
    refreshStored();
  }

  // complete 在推送回调里执行，需要读到最新的 edits / stored
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const storedRef = useRef(stored);
  storedRef.current = stored;

  function applyRead(names: string[], data: Record<string, unknown>) {
    const got = applyDevice(data, "read");
    // 读到新值后，之前的下发状态就过时了
    setDelivery((cur) => {
      const next = { ...cur };
      for (const n of got) if (next[n]?.status !== "pending") delete next[n];
      return next;
    });
    const miss = names.filter((n) => !got.has(n));
    setMissing((cur) => {
      const next = new Set(cur);
      for (const n of names) next.delete(n);
      for (const n of miss) next.add(n);
      return next;
    });
    if (miss.length) message.success(`已读取设备上的当前值，${miss.length} 项设备没有返回`);
    else message.success("已读取设备上的当前值");
    refreshStored();
  }

  function applyDevice(data: Record<string, unknown>, how: DeviceValue["how"]) {
    const at = Date.now();
    const got: Record<string, DeviceValue> = {};
    for (const [k, v] of Object.entries(data)) {
      const name = byKey.get(k) ?? k;
      got[name] = { value: v, at, how, before: storedRef.current[name]?.value };
    }
    setDevice((d) => ({ ...d, ...got }));
    setEdits((e) => {
      const next = { ...e };
      for (const n of Object.keys(got)) delete next[n];
      return next;
    });
    setErrors((e) => {
      const next = { ...e };
      for (const n of Object.keys(got)) delete next[n];
      return next;
    });
    setRev((r) => r + 1);
    return new Set(Object.keys(got));
  }

  function markDelivery(names: string[], d: Delivery) {
    setDelivery((cur) => {
      const next = { ...cur };
      for (const n of names) next[n] = d;
      return next;
    });
  }

  function refreshStored() {
    getStoredProperties(sn).then(setStored, () => {});
  }

  async function read(all: boolean) {
    const names = (schema?.properties ?? [])
      .filter((p) => readable(p) && (all || rows.includes(p)))
      .map((p) => p.propertyName);
    if (!names.length) return message.info("这一组没有能从设备读取的属性");
    const p = begin("get-property", names);
    if (!p) return;
    try {
      const data = await readDeviceProperties(sn, names);
      if (pending.current !== p) return;
      if (data && typeof data === "object") {
        // 平台直接给了值
        finish(p);
        applyRead(names, data as Record<string, unknown>);
      } else if (data === undefined || data === null || data === "") {
        finish(p);
        message.error("读取指令没有返回序列号，请稍后重试");
      } else {
        gotSeq(p, data);
      }
    } catch (e) {
      if (finish(p)) message.error(`读取失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function write() {
    if (!changed.length) return;
    const bad = changed.find((p) => errors[p.propertyName]);
    if (bad) return message.warning(`「${nameOf(bad)}」：${errors[bad.propertyName]}`);
    const missing = changed.find((p) => p.isRequired && (valueOf(p.propertyName) === undefined || valueOf(p.propertyName) === ""));
    if (missing) return message.warning(`请填写「${nameOf(missing)}」`);
    const saveOnly = changed.every((p) => p.isPlatformOnly);
    modal.confirm({
      title: saveOnly ? `保存这 ${changed.length} 项修改？` : `把这 ${changed.length} 项修改下发到设备？`,
      width: 560,
      okText: saveOnly ? "保存" : "下发到设备",
      cancelText: "再看看",
      content: (
        <div className="prop-confirm">
          <p className="muted small">{saveOnly ? "这些设置只保存在平台，不会发给设备。" : `设备（SN ${sn}）收到后会立即按新设置工作。`}</p>
          <ul>
            {changed.map((p) => {
              const lines = structuredFor(p, typeCode)?.diff?.(base(p.propertyName), valueOf(p.propertyName));
              return (
                <li key={p.propertyName}>
                  <b>{nameOf(p)}</b>
                  {lines ? (
                    <span className="prop-diff">
                      {lines.length ? lines.map((l) => <span key={l}>{l}</span>) : <span className="muted">格式整理（值不变）</span>}
                    </span>
                  ) : (
                    <>
                      <span className="mono muted">{format(p, base(p.propertyName), typeCode)}</span>
                      <span className="muted">→</span>
                      <span className="mono">{format(p, valueOf(p.propertyName), typeCode)}</span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ),
      onOk: () => doWrite(changed, saveOnly),
    });
  }

  async function doWrite(list: PropertyDef[], saveOnly: boolean, isRetry = false, values?: Record<string, unknown>) {
    if (!isRetry) {
      retried.current = false;
      forced.current = values;
    }
    const names = list.map((p) => p.propertyName);
    const props = names.map((n) => ({ propertyName: n, value: forced.current ? forced.current[n] : valueOf(n) }));
    const p = saveOnly ? undefined : begin("set-property", names);
    if (!saveOnly && !p) return;
    if (p) markDelivery(names, { status: "pending" });
    try {
      const data = await writeDeviceProperties(sn, props, saveOnly);
      if (!p || data === -1 || data === "-1") {
        // 只保存在平台
        if (p) finish(p);
        const written: Record<string, unknown> = {};
        for (const x of props) written[x.propertyName] = x.value;
        setEdits((e) => {
          const next = { ...e };
          for (const n of names) delete next[n];
          return next;
        });
        setStored((s) => {
          const next = { ...s };
          for (const n of names) next[n] = { ...next[n], value: written[n], deliveryStatus: 2, deliveryAt: dayjs().format("YYYY-MM-DD HH:mm:ss") };
          return next;
        });
        markDelivery(names, { status: "ok", at: Date.now() });
        message.success("已保存");
        refreshStored();
        return;
      }
      if (pending.current !== p) return;
      if (data === undefined || data === null || data === "") {
        finish(p);
        markDelivery(names, { status: "error", at: Date.now(), error: "没有返回序列号" });
        message.error("下发指令没有返回序列号，请稍后重试");
        return;
      }
      message.info("已下发，等待设备应答…");
      gotSeq(p, data);
    } catch (e) {
      if (p && !finish(p)) return;
      forced.current = undefined;
      markDelivery(names, { status: "error", at: Date.now(), error: e instanceof Error ? e.message : String(e) });
      message.error(`下发失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const doWriteRef = useRef(doWrite);
  doWriteRef.current = doWrite;

  // ---------- 按房间布置下发 ----------

  const layoutArrays = useMemo(() => (layout ? toDeviceArrays(layout) : undefined), [layout]);
  const layoutProps = (schema?.properties ?? []).filter((p) => ["QL_radar_config", "QL_radar_area", "QL_radar_design", "QL_radar_working_type"].includes(p.propertyName));
  const showLayoutBar = !!layoutArrays && rows.some((p) => p.propertyName === "QL_radar_area" || p.propertyName === "QL_radar_config");
  /** 设备读回 / 下发过的值和布置比：undefined = 还没读设备 */
  const devMatch =
    layoutArrays && "QL_radar_config" in device && "QL_radar_area" in device
      ? sameArray(device.QL_radar_config.value, layoutArrays.config) && sameArray(device.QL_radar_area.value ?? [], layoutArrays.area)
      : undefined;

  function pushLayout() {
    if (!layout || !layoutArrays) return;
    const values: Record<string, unknown> = {
      QL_radar_config: layoutArrays.config,
      QL_radar_area: layoutArrays.area,
      QL_radar_design: layout,
      QL_radar_working_type: layout.workingType ?? 15,
    };
    const list = layoutProps.filter((p) => p.propertyName in values);
    if (!list.some((p) => p.propertyName === "QL_radar_area")) return message.warning("这台设备没有区域属性，不能按布置下发");
    const errs = validate(layout).filter((i) => i.level === "error");
    modal.confirm({
      title: "按房间布置下发安装配置和区域？",
      width: 560,
      okText: "下发到设备",
      cancelText: "再看看",
      content: (
        <div className="prop-confirm">
          <p className="muted small">把房间布置里这台雷达的安装方式、监测范围和 {layout.ranges?.length ?? 0} 个区域发给设备（SN {sn}），设备收到后立即按新配置工作。</p>
          <ul>
            <li>
              <b>安装配置</b> <span className="mono">{JSON.stringify(layoutArrays.config)}</span>
            </li>
            <li>
              <b>区域</b> <span className="mono">{layoutArrays.area.length ? layoutArrays.area.map((a) => a.slice(0, 2).join(":")).join("，") : "没有区域"}</span>
            </li>
          </ul>
          {errs.length > 0 && <p className="err-text small">布置有问题，下发后设备可能用不了：{errs.map((i) => i.text).join("；")}</p>}
        </div>
      ),
      onOk: () => {
        if (pending.current) return message.warning("上一条指令还在等设备应答，请稍后再试");
        // 还没下发的手动修改作废，免得和布置混在一起
        setEdits((e) => {
          const next = { ...e };
          for (const p of list) delete next[p.propertyName];
          return next;
        });
        return doWrite(list, false, false, values);
      },
    });
  }

  /** 只改了区域名字 / 空间区域类型：设备不存这些，直接写到房间布置 */
  const namesDirty = !!roomId && !!planEdit?.zones && !sameNames(planEdit.zones, plan?.zones);
  const [savingNames, setSavingNames] = useState(false);
  async function saveNames() {
    if (!roomId || !planEdit?.zones) return;
    const bad = errors.QL_radar_area;
    if (bad) return message.warning(bad);
    setSavingNames(true);
    try {
      const res = await syncLayoutFromDevice(roomId, sn, {}, undefined, planEdit.zones);
      if (res.note) return notification.warning({ message: "区域名字没有保存", description: res.note, duration: 10 });
      setPlanEdit((cur) => (cur ? { ...cur, zones: undefined } : cur));
      message.success("区域名字和空间区域类型已保存到房间布置");
      onLayoutSynced?.();
    } catch (e) {
      notification.error({ message: "保存区域名字失败", description: e instanceof Error ? e.message : String(e), duration: 10 });
    } finally {
      setSavingNames(false);
    }
  }

  function undo() {
    setPlanEdit(undefined);
    setEdits({});
    setErrors({});
    setRev((r) => r + 1);
  }

  function pickGroup(g: string) {
    setGroup(g);
    try {
      localStorage.setItem(GROUP_KEY, g);
    } catch {
      /* 记不住也没关系 */
    }
  }

  // ---------- 界面 ----------

  if (loadError)
    return (
      <div className="pp-empty">
        <p>没能读取这台设备的属性：{loadError}</p>
        <Button size="small" onClick={load}>
          重新读取
        </Button>
      </div>
    );
  if (!schema) return <Spin style={{ display: "block", marginTop: 80 }} />;
  if (!schema.properties.length) return <div className="pp-empty">这类设备没有可以配置的属性。</div>;

  const changedIn = (code: string) => changed.filter((p) => (code === UNGROUPED ? !p.propertyGroupStringCode : p.propertyGroupStringCode === code)).length;
  const groupLabel = groups.find((g) => g.value === group)?.label ?? "";
  const groupText = GROUP_TEXT[groupLabel];
  const readRows = rows.filter(readable);
  // 这一组最近一次从设备读到值的时间
  const lastRead = Math.max(0, ...readRows.map((p) => (device[p.propertyName]?.how === "read" ? device[p.propertyName].at : 0)));
  const allReadOnly = rows.length > 0 && rows.every(readOnly);

  return (
      <div className="pp">
        <div className="pp-strip">
          <span className={`pp-link ${online ? "ok" : "warn"}`}>
            <i />
            {online ? "设备在线" : "设备离线，读取和下发会等不到应答"}
          </span>
          {rtState !== "connected" && (
            <span className="pp-link warn">
              <i />
              {rtState === "connecting" || rtState === "reconnecting" ? "实时通道正在连接" : "实时通道未连接，收不到设备应答"}
            </span>
          )}
          <span className="pp-source">
            {busy === "get-property"
              ? "正在读取设备…"
              : busy === "set-property"
                ? "正在等设备确认…"
                : lastRead
                  ? `${dayjs(lastRead).format("HH:mm:ss")} 从设备读取`
                  : readRows.length
                    ? "现在显示的是平台记录的值"
                    : ""}
          </span>
          <Space.Compact className="pp-read">
            <Button icon={<CloudDownloadOutlined />} loading={busy === "get-property"} disabled={!!busy || !readRows.length} onClick={() => read(false)}>
              读取本组
            </Button>
            <Tooltip title="读取所有分组">
              <Button disabled={!!busy} onClick={() => read(true)}>
                全部
              </Button>
            </Tooltip>
          </Space.Compact>
          <Tooltip title="重新加载平台记录">
            <Button type="text" icon={<ReloadOutlined />} onClick={load} />
          </Tooltip>
        </div>

        <div className="pp-body">
          <nav className="pp-nav" aria-label="属性分组">
            {groups.map((g) => (
              <button
                key={g.value}
                type="button"
                className={g.value === group ? "on" : undefined}
                aria-current={g.value === group ? "true" : undefined}
                onClick={() => pickGroup(g.value)}
              >
                {g.label}
                {changedIn(g.value) > 0 && <b title={`改了 ${changedIn(g.value)} 项`}>{changedIn(g.value)}</b>}
              </button>
            ))}
          </nav>

          <section className="pp-group">
            <header>
              <h2>{groupLabel}</h2>
              {groupText && <p>{groupText}</p>}
            </header>
            {hasCallProps && (
              <div className="pp-layout">
                <span>
                  紧急号码、备用号码、云对讲 / 局域网、SIP 号、呼叫等待、通话录音这些通话设置都在<b>通话</b>页里改。
                </span>
                {onGoCall && (
                  <Button size="small" onClick={onGoCall}>
                    去通话页
                  </Button>
                )}
              </div>
            )}
            {showLayoutBar && (
              <div className="pp-layout" data-spot="layout">
                <span>
                  <b>房间布置</b>：{layout?.installType === 0 ? "顶装" : "侧装"}，{layout?.ranges?.length ?? 0} 个区域
                  {devMatch === true ? "，设备上一致" : devMatch === false ? "，设备上不一样" : "（平台记录可能已被保存布置改过，不代表设备上是这个，读取本组可以核对）"}
                </span>
                <Button size="small" icon={<CloudUploadOutlined />} disabled={!!busy || !online} onClick={pushLayout}>
                  按房间布置下发
                </Button>
              </div>
            )}
            {allReadOnly ? (
              <dl className="pp-kv">
                {rows.map((p) => (
                  <div key={p.propertyName}>
                    <dt>{nameOf(p)}</dt>
                    <dd>{format(p, valueOf(p.propertyName), typeCode)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="pp-rows">
                {rows.map((p) => (
                  <SettingRow
                    key={p.propertyName}
                    p={p}
                    value={valueOf(p.propertyName)}
                    rev={rev}
                    modified={isModified(p.propertyName)}
                    error={errors[p.propertyName]}
                    dev={device[p.propertyName]}
                    stored={stored[p.propertyName]}
                    delivery={delivery[p.propertyName]}
                    missing={missing.has(p.propertyName)}
                    typeCode={typeCode}
                    ctx={ctx}
                    sn={sn}
                    disabled={busy === "set-property"}
                    onChange={(v) => setValue(p.propertyName, v)}
                    setOther={setValue}
                    setPlan={setPlan}
                    onError={(err) => setError(p.propertyName, err)}
                  />
                ))}
              </div>
            )}
            {!rows.length && !hasCallProps && <p className="pp-empty">这一组现在没有要显示的设置。</p>}
          </section>
        </div>

        {namesDirty && !changed.length && busy !== "set-property" && (
          <div className="pp-bar" role="region" aria-label="未保存的区域名字">
            <span>改了区域名字 / 空间区域类型（只存在房间布置里，不用下发）</span>
            <Button disabled={savingNames} onClick={undo}>
              撤销
            </Button>
            <Button type="primary" loading={savingNames} onClick={saveNames}>
              保存到房间布置
            </Button>
          </div>
        )}
        {(changed.length > 0 || busy === "set-property") && (
          <div className="pp-bar" role="region" aria-label="未下发的修改">
            <span>{busy === "set-property" ? "已下发，正在等设备确认…" : `改了 ${changed.length} 项：${changed.map(nameOf).join("、")}`}</span>
            <Button disabled={busy === "set-property"} onClick={undo}>
              撤销
            </Button>
            <Button type="primary" icon={<CloudUploadOutlined />} loading={busy === "set-property"} disabled={!!busy} onClick={write}>
              {changed.every((p) => p.isPlatformOnly) ? "保存" : "下发到设备"}
            </Button>
          </div>
        )}
      </div>
  );
}

function sameNames(a: Record<number, ZoneMeta>, b?: Record<number, ZoneMeta>) {
  const norm = (m?: Record<number, ZoneMeta>) =>
    JSON.stringify(Object.entries(m ?? {}).map(([k, v]) => [Number(k), v.text?.trim() || "", v.spaceType ?? null]).sort((x, y) => (x[0] as number) - (y[0] as number)));
  return norm(a) === norm(b);
}

function groupsOf(s: PropertySchema) {
  const used = new Set(s.properties.map((p) => p.propertyGroupStringCode ?? UNGROUPED));
  const list = s.groups.filter((g) => used.has(g.stringCode)).map((g) => ({ value: g.stringCode, label: g.label }));
  if (used.has(UNGROUPED) || s.properties.some((p) => p.propertyGroupStringCode && !s.groups.some((g) => g.stringCode === p.propertyGroupStringCode)))
    list.push({ value: UNGROUPED, label: "其他" });
  return list;
}

/** 每行的一句状态：只说最要紧的那件事，平台记录的下发时间放在悬停提示里 */
function rowState(o: { modified: boolean; error?: string; dev?: DeviceValue; stored?: StoredProperty; delivery?: Delivery; missing: boolean; differs: string | false }) {
  const { modified, error, dev, stored, delivery, missing, differs } = o;
  if (error) return { cls: "err", text: error };
  if (delivery?.status === "pending") return { cls: "busy", text: "正在等设备确认…" };
  if (delivery?.status === "error") return { cls: "err", text: `下发失败：${delivery.error ?? ""}` };
  if (delivery?.status === "timeout") return { cls: "err", text: "设备没有确认，可以到通信日志里查看" };
  if (delivery?.status === "ok") return { cls: "ok", text: `${dayjs(delivery.at).format("HH:mm")} 已下发到设备` };
  if (modified) return { cls: "mod", text: "已修改，还没下发" };
  if (missing) return { cls: "muted", text: "设备没有返回这一项，可能是固件不支持" };
  if (differs) return { cls: "warn", text: differs };
  if (dev) return { cls: "ok", text: "设备上的当前值" };
  if (stored?.deliveryStatus === 3) return { cls: "err", text: `上次下发失败${stored.deliveryError ? `：${stored.deliveryError}` : ""}` };
  return undefined;
}

function SettingRow({
  p,
  value,
  rev,
  modified,
  error,
  dev,
  stored,
  delivery,
  missing,
  typeCode,
  ctx,
  sn,
  disabled,
  onChange,
  onError,
  setOther,
  setPlan,
}: {
  p: PropertyDef;
  value: unknown;
  rev: number;
  modified: boolean;
  error?: string;
  dev?: DeviceValue;
  stored?: StoredProperty;
  delivery?: Delivery;
  missing: boolean;
  typeCode?: number;
  ctx: Record<string, unknown>;
  sn: string;
  disabled: boolean;
  onChange: (v: unknown) => void;
  onError: (err?: string) => void;
  setOther?: (name: string, v: unknown) => void;
  setPlan?: (p: Partial<PlanCtx>) => void;
}) {
  const st = structuredFor(p, typeCode);
  // 设备上的值和读取前的平台记录不一样：有人在别处改过，或者上次下发没生效
  const differs = dev?.how === "read" && dev.before !== undefined && !same(dev.value, dev.before) && `平台记录是 ${format(p, dev.before, typeCode)}，与设备不一致`;
  const state = rowState({ modified, error, dev, stored, delivery, missing, differs });
  const record = stored?.deliveryAt ? `平台记录：${stored.deliveryAt.slice(0, 16)}${stored.deliveryByUserName ? `，${stored.deliveryByUserName}` : ""}` : undefined;
  const desc = descOf(p);
  const ro = readOnly(p);

  const head = (
    <div className="pp-name">
      <span>
        {nameOf(p)}
        {p.isPlatformOnly && <em>只存在平台</em>}
      </span>
      {desc && <small>{desc}</small>}
    </div>
  );
  const status = state && (
    <span className={`pp-state ${state.cls}`} title={record}>
      {state.text}
    </span>
  );

  if (st?.wide)
    return (
      <div className={`pp-row wide${modified ? " modified" : ""}`} data-spot={p.propertyName}>
        <div className="pp-row-head">
          {head}
          {status}
        </div>
        <st.Editor key={rev} value={value} onChange={onChange} onError={onError} disabled={disabled || ro} ctx={ctx} sn={sn} setOther={setOther} setPlan={setPlan} />
      </div>
    );

  return (
    <div className={`pp-row${modified ? " modified" : ""}`} data-spot={p.propertyName}>
      {head}
      <div className="pp-control">
        {st ? (
          <st.Editor key={rev} value={value} onChange={onChange} onError={onError} disabled={disabled || ro} ctx={ctx} sn={sn} setOther={setOther} setPlan={setPlan} />
        ) : (
          <Editor key={`${p.propertyName}:${rev}`} p={p} value={value} disabled={disabled} onChange={onChange} onError={onError} />
        )}
        {status}
      </div>
    </div>
  );
}

const isNum = (t: number) => t >= 2 && t <= 6;

function Editor({
  p,
  value,
  disabled,
  onChange,
  onError,
}: {
  p: PropertyDef;
  value: unknown;
  disabled: boolean;
  onChange: (v: unknown) => void;
  onError: (err?: string) => void;
}) {
  const fp = p.fieldProps ?? {};
  if (readOnly(p)) {
    const text = format(p, value);
    return (
      <span className={`prop-readonly${typeof value === "object" && value ? " mono" : ""}`} title={p.displayType === 8 ? "音频文件在平台网页端配置" : undefined}>
        {p.displayType === 8 ? (value ? "已配置音频" : "—") : text}
      </span>
    );
  }
  if (p.displayType === 5 || p.dataType === 7) {
    const on = fp.openValue ?? (p.dataType === 7 ? true : 1);
    const off = fp.closeValue ?? (p.dataType === 7 ? false : 0);
    return (
      <Switch
        size="small"
        disabled={disabled}
        checked={same(value, on)}
        onChange={(c) => onChange(c ? on : off)}
      />
    );
  }
  if (p.displayType === 7 && fp.options?.length && fp.multiple) {
    const list = Array.isArray(value) ? [...new Set(value as (string | number)[])] : [];
    return (
      <Select
        size="small"
        mode="multiple"
        disabled={disabled}
        value={list}
        onChange={(v: (string | number)[]) => onChange(v)}
        options={fp.options.map((o) => ({ label: o.label, value: o.value }))}
        placeholder="都不选表示不上报"
        style={{ width: "100%", maxWidth: 360 }}
      />
    );
  }
  if (p.displayType === 7 && fp.options?.length) {
    return (
      <Select
        size="small"
        disabled={disabled}
        value={value as string | number | undefined}
        onChange={onChange}
        options={fp.options.map((o) => ({ label: o.label, value: o.value }))}
        style={{ width: 200 }}
        allowClear={!p.isRequired}
      />
    );
  }
  if (isNum(p.dataType) && (p.displayType === 4 || p.displayType === 0 || p.displayType === 2)) {
    return (
      <InputNumber
        size="small"
        disabled={disabled}
        value={typeof value === "number" ? value : value === undefined || value === null || value === "" ? null : Number(value)}
        min={fp.min}
        max={fp.max}
        precision={p.dataType === 5 || p.dataType === 6 ? undefined : 0}
        suffix={p.unit || undefined}
        placeholder={fp.min !== undefined && fp.max !== undefined ? `${fp.min}–${fp.max}` : undefined}
        onChange={(v) => onChange(v ?? undefined)}
        style={{ width: 140 }}
      />
    );
  }
  if (p.dataType === 8 || p.dataType === 9) return <JsonEditor value={value} disabled={disabled} onChange={onChange} onError={onError} />;
  const Comp = SECRET.test(p.propertyName) ? Input.Password : Input;
  if (p.displayType === 3)
    return (
      <Input.TextArea
        size="small"
        disabled={disabled}
        value={value === undefined || value === null ? "" : String(value)}
        autoSize={{ minRows: 1, maxRows: 5 }}
        maxLength={fp.maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <Comp
      size="small"
      disabled={disabled}
      value={value === undefined || value === null ? "" : String(value)}
      maxLength={fp.maxLength}
      onChange={(e) => onChange(e.target.value)}
      style={{ maxWidth: 320 }}
    />
  );
}

/** 数组 / JSON 属性：按 JSON 文本编辑，解析不了时不更新值并提示 */
function JsonEditor({ value, disabled, onChange, onError }: { value: unknown; disabled: boolean; onChange: (v: unknown) => void; onError: (err?: string) => void }) {
  const [text, setText] = useState(() => (value === undefined ? "" : JSON.stringify(value)));
  return (
    <Input.TextArea
      size="small"
      className="mono"
      disabled={disabled}
      value={text}
      autoSize={{ minRows: 1, maxRows: 6 }}
      placeholder="JSON，例如 [1, 2, 3]"
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (!t.trim()) {
          onError(undefined);
          onChange(undefined);
          return;
        }
        try {
          onChange(JSON.parse(t));
          onError(undefined);
        } catch {
          onError("不是有效的 JSON");
        }
      }}
    />
  );
}
