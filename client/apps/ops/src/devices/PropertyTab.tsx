import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Badge, Button, Empty, Input, InputNumber, Segmented, Select, Space, Spin, Switch, Tooltip } from "antd";
import { CloudDownloadOutlined, CloudUploadOutlined, ReloadOutlined, UndoOutlined } from "@ant-design/icons";
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

/**
 * 设备属性：读取设备上的当前值、修改后下发（与平台"设备配置 › 存储属性"同一套接口）。
 * 读取 / 下发都是异步的：接口先返回 seq，设备应答从实时推送 DeviceResponse 回来，30 秒收不到算超时。
 * 同一时间只等一条指令。
 */

const TIMEOUT_MS = 30_000;
const UNGROUPED = "__ungrouped";
const GROUP_KEY = "ops:prop-group";
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

function format(p: PropertyDef, v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (SECRET.test(p.propertyName)) return "••••••";
  const fp = p.fieldProps ?? {};
  if (p.displayType === 5) return same(v, fp.openValue ?? 1) ? "开" : same(v, fp.closeValue ?? 0) ? "关" : String(v);
  if (p.displayType === 7) return fp.options?.find((o) => String(o.value) === String(v))?.label ?? String(v);
  if (p.displayType === 9 && Array.isArray(v)) return v.length ? v.join("，") : "全天";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v) + (p.unit ? ` ${p.unit}` : "");
}

export default function PropertyTab({ sn, online }: { sn: string; online: boolean }) {
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

  useEffect(() => realtime.onState((s) => setRtState(s)), []);

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

  const base = (name: string) => (name in device ? device[name].value : stored[name]?.value);
  const valueOf = (name: string) => (name in edits ? edits[name] : base(name));
  const isModified = (name: string) => name in edits && !same(edits[name], base(name));

  const ctx = useMemo(() => {
    const c: Record<string, unknown> = {};
    for (const p of schema?.properties ?? []) c[p.propertyName] = p.propertyName in edits ? edits[p.propertyName] : base(p.propertyName);
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, stored, device, edits]);

  const visible = (p: PropertyDef) => visibleBy(p.fieldProps?.visibleExpression, ctx);
  const changed = (schema?.properties ?? []).filter((p) => !readOnly(p) && !p.isBuiltIn && visible(p) && isModified(p.propertyName));
  const groups = schema ? groupsOf(schema) : [];
  const rows = (schema?.properties ?? [])
    .filter((p) => (group === UNGROUPED ? !p.propertyGroupStringCode : p.propertyGroupStringCode === group))
    .filter(visible);

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
        applyRead(p.names, r.data ?? {});
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
      for (const n of p.names) written[n] = editsRef.current[n];
      applyDevice(written, "write");
      message.success("设备已接收下发的属性");
    } else {
      markDelivery(p.names, { status: "error", at: now, error: `${r.message ?? "下发失败"}（code ${r.code}）` });
      notification.error({ message: "下发设备属性失败", description: `${r.message ?? ""}（code ${r.code}）`, duration: 10 });
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
    if (bad) return message.warning(`「${bad.title}」的内容不是有效的 JSON`);
    const missing = changed.find((p) => p.isRequired && (valueOf(p.propertyName) === undefined || valueOf(p.propertyName) === ""));
    if (missing) return message.warning(`请填写「${missing.title}」`);
    const saveOnly = changed.every((p) => p.isPlatformOnly);
    modal.confirm({
      title: saveOnly ? `保存 ${changed.length} 项平台属性？` : `下发 ${changed.length} 项属性到设备？`,
      width: 560,
      okText: saveOnly ? "保存" : "下发",
      content: (
        <div className="prop-confirm">
          <p className="muted small">
            SN <span className="mono">{sn}</span>
            {saveOnly ? "，只保存在平台，不下发到设备。" : "，平台会保存并立即下发，设备会按新值工作。"}
          </p>
          <ul>
            {changed.map((p) => (
              <li key={p.propertyName}>
                <b>{p.title}</b>
                <span className="mono muted">{format(p, base(p.propertyName))}</span>
                <span className="muted">→</span>
                <span className="mono">{format(p, valueOf(p.propertyName))}</span>
              </li>
            ))}
          </ul>
        </div>
      ),
      onOk: () => doWrite(changed, saveOnly),
    });
  }

  async function doWrite(list: PropertyDef[], saveOnly: boolean) {
    const names = list.map((p) => p.propertyName);
    const props = names.map((n) => ({ propertyName: n, value: valueOf(n) }));
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
      markDelivery(names, { status: "error", at: Date.now(), error: e instanceof Error ? e.message : String(e) });
      message.error(`下发失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function undo() {
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
      <Alert
        type="error"
        showIcon
        message="读取属性定义失败"
        description={loadError}
        action={
          <Button size="small" onClick={load}>
            重试
          </Button>
        }
      />
    );
  if (!schema) return <Spin style={{ display: "block", marginTop: 80 }} />;
  if (!schema.properties.length) return <Empty style={{ marginTop: 80 }} description="这个设备类型没有可配置的属性" />;

  const changedIn = (code: string) => changed.filter((p) => (code === UNGROUPED ? !p.propertyGroupStringCode : p.propertyGroupStringCode === code)).length;

  return (
    <div className="props">
      <div className="toolbar">
        <Segmented
          value={group}
          onChange={(v) => pickGroup(String(v))}
          options={groups.map((g) => ({
            value: g.value,
            label: (
              <Badge dot={changedIn(g.value) > 0} offset={[4, 0]}>
                {g.label}
              </Badge>
            ),
          }))}
        />
      </div>
      <div className="toolbar">
        <Space.Compact>
          <Button icon={<CloudDownloadOutlined />} loading={busy === "get-property"} disabled={!!busy} onClick={() => read(false)}>
            从设备读取本组
          </Button>
          <Tooltip title="读取所有分组的属性">
            <Button disabled={!!busy} onClick={() => read(true)}>
              全部
            </Button>
          </Tooltip>
        </Space.Compact>
        <Button type="primary" icon={<CloudUploadOutlined />} loading={busy === "set-property"} disabled={!changed.length || !!busy} onClick={write}>
          下发修改{changed.length ? `（${changed.length}）` : ""}
        </Button>
        <Button icon={<UndoOutlined />} disabled={!Object.keys(edits).length || busy === "set-property"} onClick={undo}>
          撤销修改
        </Button>
        <Button type="text" icon={<ReloadOutlined />} title="重新读取平台记录" onClick={load} style={{ marginLeft: "auto" }} />
      </div>
      {!online && <Alert type="warning" showIcon message="设备当前离线，读取和下发会等不到应答。" />}
      {rtState !== "connected" && (
        <Alert type="warning" showIcon message={`实时通道${rtState === "connecting" || rtState === "reconnecting" ? "正在连接" : "未连接"}，收不到设备应答；结果可以到通信日志里查看。`} />
      )}
      {group === "radar_config" && (
        <Alert type="info" showIcon message="安装设置（探测区域、区域划分）平时由房间布局下发。在这里直接改，房间布局里的配置不会跟着变。" />
      )}
      <div className="prop-table">
        <div className="prop-head">
          <span>属性</span>
          <span>值</span>
          <span>状态</span>
        </div>
        {rows.map((p) => (
          <PropertyRow
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
            disabled={busy === "set-property"}
            onChange={(v) => setValue(p.propertyName, v)}
            onError={(err) => setError(p.propertyName, err)}
          />
        ))}
        {!rows.length && <p className="muted small prop-empty">这一组没有要显示的属性</p>}
      </div>
    </div>
  );
}

function groupsOf(s: PropertySchema) {
  const used = new Set(s.properties.map((p) => p.propertyGroupStringCode ?? UNGROUPED));
  const list = s.groups.filter((g) => used.has(g.stringCode)).map((g) => ({ value: g.stringCode, label: g.label }));
  if (used.has(UNGROUPED) || s.properties.some((p) => p.propertyGroupStringCode && !s.groups.some((g) => g.stringCode === p.propertyGroupStringCode)))
    list.push({ value: UNGROUPED, label: "未分组" });
  return list;
}

function PropertyRow({
  p,
  value,
  rev,
  modified,
  error,
  dev,
  stored,
  delivery,
  missing,
  disabled,
  onChange,
  onError,
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
  disabled: boolean;
  onChange: (v: unknown) => void;
  onError: (err?: string) => void;
}) {
  const tags: React.ReactNode[] = [];
  if (modified) tags.push(<span key="m" className="ptag mod">已修改</span>);
  if (delivery?.status === "pending") tags.push(<span key="d" className="ptag pend">等待设备应答</span>);
  else if (delivery?.status === "ok") tags.push(<span key="d" className="ptag ok">下发成功 {dayjs(delivery.at).format("HH:mm:ss")}</span>);
  else if (delivery?.status === "error")
    tags.push(
      <span key="d" className="ptag err" title={delivery.error}>
        下发失败
      </span>,
    );
  else if (delivery?.status === "timeout") tags.push(<span key="d" className="ptag err">应答超时</span>);
  if (dev && !delivery) tags.push(<span key="r" className="ptag dev">设备值 {dayjs(dev.at).format("HH:mm:ss")}</span>);
  if (missing && !delivery)
    tags.push(
      <span key="x" className="ptag pend" title="读取时设备没有返回这一项，可能是固件不支持">
        设备未返回
      </span>,
    );

  // 设备上的值和读取前的平台记录不一样：说明有人在别处改过，或者上次下发没生效
  const differs = dev?.how === "read" && dev.before !== undefined && !same(dev.value, dev.before);
  const rec = stored?.deliveryAt
    ? `平台记录 ${stored.deliveryAt.slice(5, 16)}${stored.deliveryByUserName ? ` · ${stored.deliveryByUserName}` : ""}${
        stored.deliveryStatus === 3 ? " · 下发失败" : stored.deliveryStatus === 1 ? " · 下发中" : ""
      }`
    : undefined;

  return (
    <div className={`prop-row${modified ? " modified" : ""}`}>
      <div className="prop-name">
        <span>
          {p.title}
          {p.isRequired && <em className="req">*</em>}
        </span>
        <small className="mono muted" title={p.aliasName ? `报文里是 ${p.aliasName}` : undefined}>
          {p.propertyName}
          {p.isPlatformOnly ? " · 平台" : p.accessMode === 2 ? " · 只读" : p.accessMode === 3 ? " · 只写" : ""}
        </small>
      </div>
      <div className="prop-value">
        <Editor key={`${p.propertyName}:${rev}`} p={p} value={value} disabled={disabled} onChange={onChange} onError={onError} />
        {error && <small className="prop-err">{error}</small>}
      </div>
      <div className="prop-state">
        {tags.length > 0 && <div className="ptags">{tags}</div>}
        {differs && (
          <small className="warn-text" title="设备上的值与读取前的平台记录不一致，可能有人在别处改过，或者上次下发没生效">
            读取前平台记录：{format(p, dev!.before)}
          </small>
        )}
        {rec && <small className="muted">{rec}</small>}
        {delivery?.status === "error" && delivery.error && <small className="prop-err">{delivery.error}</small>}
        {stored?.deliveryStatus === 3 && stored.deliveryError && !delivery && <small className="prop-err">{stored.deliveryError}</small>}
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
        checkedChildren="开"
        unCheckedChildren="关"
        style={{ alignSelf: "flex-start" }}
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
  if (p.displayType === 9) {
    const list = Array.isArray(value) ? (value as string[]) : [];
    const max = fp.timeRangeMaxCount ?? 5;
    return (
      <Select
        size="small"
        mode="tags"
        disabled={disabled}
        value={list}
        open={false}
        suffixIcon={null}
        tokenSeparators={[",", "，", " "]}
        placeholder="留空表示全天；输入 08:00-20:00 回车添加"
        onChange={(v: string[]) => {
          const bad = v.find((x) => !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(x));
          if (bad) onError(`「${bad}」格式不对，应为 HH:mm-HH:mm`);
          else if (v.length > max) onError(`最多 ${max} 段`);
          else onError(undefined);
          onChange(v);
        }}
        style={{ width: "100%" }}
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
        addonAfter={p.unit || undefined}
        placeholder={fp.min !== undefined && fp.max !== undefined ? `${fp.min}–${fp.max}` : undefined}
        onChange={(v) => onChange(v ?? undefined)}
        style={{ width: 160 }}
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
