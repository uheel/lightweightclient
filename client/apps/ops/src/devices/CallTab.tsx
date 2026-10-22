import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Collapse, Input, InputNumber, Segmented, Select, Space, Spin, Switch, Tag } from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { realtime } from "@radar/core";
import {
  awaitDeviceResponse,
  getStoredProperties,
  isResponseOk,
  readDeviceProperties,
  writeDeviceProperties,
  type DeviceResponse,
  type Radar,
} from "../api/device";
import {
  addRoomToMaster,
  getAvailableSip,
  getMasterOptions,
  getRadarCallConfig,
  saveRadarCallConfig,
  type MasterOption,
  type RadarCallConfig,
} from "../api/master";
import { getDeviceScenes } from "../api/scene";
import { callsMaster } from "../scenes/plan";
import LanDiagnosis from "./LanDiagnosis";
import CallRecords from "./master/CallRecords";
import { isMobileNumber, toDialNumber, toShownNumber } from "./dialNumber";

/**
 * 雷达的通话设置，通话相关的都在这一页（设备属性里不再编辑），按用户关心的问题分三块：
 * 1. 告警时打给谁：紧急号码 + 没人接再打的备用号码。告警场景的"呼叫管理主机"动作拨的就是紧急号码，号码可以是手机、主机或别的 SIP 号
 * 2. 管理主机呼叫这台雷达：所属主机（平台的 masterId）和覆盖房间。主机按覆盖房间的通讯录主动呼雷达，和紧急号码无关
 * 3. 线路设置：云对讲 / 局域网、本机 SIP 号、呼叫等待、通话时长、通话录音
 * 规则见 docs/site-analysis.md"管理主机与 SIP 通话"。保存走平台的通话配置接口，平台只把变了的属性下发给设备
 */

/** 一个呼叫对象：手机（存设备时按 SIP 服务器加前缀）/ 管理主机（主机的 SIP 号）/ 其他 SIP 号 */
interface Target {
  kind: "phone" | "master" | "sip";
  /** 手机：11 位；SIP：号码；主机：主机 id */
  value: string;
}

const KEY_NAMES = ["talk_key1_number", "talk_key2_number", "talk_key3_number"] as const;
const READ_NAMES = [
  "talk_type_sel",
  "talk_master_number",
  "sip_account",
  "sip_server",
  "talk_call_number_bak",
  ...KEY_NAMES,
  "talk_call_timeout",
  "talk_local_maxtime",
  "call_record_EN",
];

/** 设备上的现值（字典名和报文键不一致的两种都认，例如 sip_account ↔ talk_local_number） */
interface Current {
  type?: number;
  master?: string;
  local?: string;
  server?: string;
  bak?: number;
  keys: string[];
  timeout?: number;
  maxtime?: number;
  record?: number;
  from: "device" | "platform";
}

function pickCurrent(v: Record<string, unknown>, from: Current["from"]): Current {
  const val = (k: string) => {
    const x = v[k];
    return x && typeof x === "object" && "value" in x ? (x as { value: unknown }).value : x;
  };
  const str = (...ks: string[]) => {
    for (const k of ks) {
      const x = val(k);
      if (x !== undefined && x !== null && x !== "") return String(x);
    }
  };
  const num = (k: string) => {
    const s = str(k);
    return s === undefined ? undefined : Number(s);
  };
  return {
    type: num("talk_type_sel"),
    master: str("talk_master_number"),
    local: str("talk_local_number", "sip_account"),
    server: str("talk_sip_server", "sip_server"),
    bak: num("talk_call_number_bak"),
    keys: KEY_NAMES.map((k) => str(k) ?? ""),
    timeout: num("talk_call_timeout"),
    maxtime: num("talk_local_maxtime"),
    record: num("call_record_EN"),
    from,
  };
}

/** 设备上存的号码 → 呼叫对象 */
function toTarget(stored: string | undefined, masters: MasterOption[]): Target {
  const n = stored ?? "";
  const m = n && masters.find((x) => x.sipUserName === n);
  if (m) return { kind: "master", value: m.id };
  if (isMobileNumber(n)) return { kind: "phone", value: toShownNumber(n) };
  return { kind: n ? "sip" : "phone", value: n };
}

/** 呼叫对象 → 存到设备的号码 */
function toStored(t: Target, masters: MasterOption[], sipServer?: string) {
  if (t.kind === "master") return masters.find((m) => m.id === t.value)?.sipUserName ?? "";
  if (t.kind === "phone") return toDialNumber(t.value, sipServer);
  return t.value.trim();
}

/** 呼叫对象哪里不对（空的不算错，由调用方决定要不要） */
function targetError(t: Target, masters: MasterOption[]) {
  if (t.kind === "phone" && t.value && !/^1[3-9]\d{9}$/.test(t.value.replace(/[\s-]/g, ""))) return "手机号是 11 位";
  if (t.kind === "master" && t.value && !masters.find((m) => m.id === t.value)?.sipUserName) return "这台主机还没有 SIP 号";
}

const shown = (stored: string | undefined, masters: MasterOption[]) => {
  const m = stored && masters.find((x) => x.sipUserName === stored);
  return m ? `主机 ${m.deviceName || m.sn}` : toShownNumber(stored) || "（空）";
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 选呼叫对象：类型 + 号码 / 主机 */
function TargetPicker({ value, onChange, masters, disabled }: { value: Target; onChange: (t: Target) => void; masters: MasterOption[]; disabled?: boolean }) {
  const err = targetError(value, masters);
  return (
    <div>
      <Space.Compact style={{ width: "100%", maxWidth: 380 }}>
        <Select
          style={{ width: 104 }}
          disabled={disabled}
          value={value.kind}
          onChange={(kind) => onChange({ kind, value: kind === "master" ? (masters.find((m) => m.sipUserName)?.id ?? "") : "" })}
          options={[
            { value: "phone", label: "手机" },
            { value: "master", label: "管理主机", disabled: !masters.length },
            { value: "sip", label: "SIP 号" },
          ]}
        />
        {value.kind === "master" ? (
          <Select
            style={{ flex: 1 }}
            disabled={disabled}
            placeholder="选主机"
            value={value.value || undefined}
            onChange={(v) => onChange({ kind: "master", value: v })}
            options={masters.map((m) => ({ value: m.id, label: `${m.deviceName || m.sn}${m.sipUserName ? ` · SIP ${m.sipUserName}` : " · 没有 SIP 号"}` }))}
          />
        ) : (
          <Input
            style={{ flex: 1 }}
            disabled={disabled}
            allowClear
            status={err ? "error" : undefined}
            placeholder={value.kind === "phone" ? "11 位手机号" : "SIP 号"}
            value={value.value}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
          />
        )}
      </Space.Compact>
      {err && <div className="small err-text">{err}</div>}
    </div>
  );
}

export default function CallTab({ d, online, onGoAlarm }: { d: Radar; online: boolean; onGoAlarm?: () => void }) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [masters, setMasters] = useState<MasterOption[]>([]);
  const [cfg, setCfg] = useState<RadarCallConfig>({});
  const [cur, setCur] = useState<Current>({ from: "platform", keys: [] });
  /** 会拨号的告警（平台记录的场景里带"呼叫管理主机"动作的） */
  const [dialScenes, setDialScenes] = useState<string[]>();

  // 表单
  const [emergency, setEmergency] = useState<Target>({ kind: "phone", value: "" });
  const [backups, setBackups] = useState<Target[]>([]);
  const [masterId, setMasterId] = useState<string>();
  const [type, setType] = useState(1);
  const [timeout, setTimeoutSec] = useState<number | null>(null);
  const [maxtime, setMaxtime] = useState<number | null>(null);
  const [record, setRecord] = useState(0);
  /** 新分配、还没保存的 SIP 账号 */
  const [newSip, setNewSip] = useState<{ sipAccount?: string; sipPassword?: string }>();
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  async function readDevice() {
    setReading(true);
    try {
      const data = await awaitDeviceResponse<Record<string, unknown>>(d.sn, "get-property", () => readDeviceProperties(d.sn, READ_NAMES));
      return pickCurrent(data ?? {}, "device");
    } catch (e) {
      message.warning(`没读到设备上的通话设置（${errText(e)}），先按平台记录显示`);
    } finally {
      setReading(false);
    }
  }

  /** 把现值填进表单 */
  function fill(now: Current, ms: MasterOption[], c: RadarCallConfig) {
    setCur(now);
    setEmergency(toTarget(now.master, ms));
    // 备用号码只在打开"呼叫备用号码"时算数；关着时填了的也不显示，免得以为会拨
    setBackups(now.bak ? now.keys.filter(Boolean).map((k) => toTarget(k, ms)) : []);
    // 平台不一定记了 masterId：没记时按紧急号码对上主机的 SIP 号
    setMasterId(c.masterId || ms.find((m) => m.sipUserName && m.sipUserName === now.master)?.id);
    setType(now.type ?? 1);
    setTimeoutSec(now.timeout ?? null);
    setMaxtime(now.maxtime ?? null);
    setRecord(now.record ?? 0);
    setNewSip(undefined);
  }

  async function load() {
    setLoading(true);
    try {
      const [ms, c, stored] = await Promise.all([getMasterOptions(d), getRadarCallConfig(d), getStoredProperties(d.sn).catch(() => ({}))]);
      setMasters(ms);
      setCfg(c);
      const platform = { ...pickCurrent(stored as Record<string, unknown>, "platform"), ...dropEmpty(pickCurrent(c.call ?? {}, "platform")) };
      fill(platform, ms, c);
      setLoading(false);
      getDeviceScenes(d.id).then(
        (s) => setDialScenes(s.filter((x) => !x.isDisabled && callsMaster(x)).map((x) => x.sceneName)),
        () => setDialScenes([]),
      );
      if (online && !d.isDisabled) {
        const dev = await readDevice();
        if (dev) fill(dev, ms, c);
      }
    } catch (e) {
      message.error(`读取通话设置失败：${errText(e)}`);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id]);

  const master = masters.find((m) => m.id === masterId);
  const lan = type === 0;
  const sipServer = (cur.server ?? cfg.call?.talk_sip_server ?? master?.sipServer) as string | undefined;
  const localSip = newSip?.sipAccount ?? cur.local;

  // 局域网没有 SIP 服务器，雷达只能直接拨主机 IP，号码不起作用：紧急号码保留原值，不拨备用号码
  const targetNumber = lan ? (cur.master ?? "") : toStored(emergency, masters, sipServer);
  // 没加备用号码、设备上本来也没开时，原来存着的号码不动（关着不拨，没必要清掉，也不算改动）
  const targetKeys =
    lan || (!backups.length && !cur.bak) ? [0, 1, 2].map((i) => cur.keys[i] ?? "") : [0, 1, 2].map((i) => (backups[i] ? toStored(backups[i], masters, sipServer) : ""));
  const targetBak = lan ? (cur.bak ?? 0) : backups.some((t) => t.value) ? 1 : 0;

  const changes = useMemo(() => {
    const out: string[] = [];
    if (targetNumber !== (cur.master ?? "")) out.push(`告警打给 ${shown(targetNumber, masters)}`);
    if (targetBak !== (cur.bak ?? 0) || targetKeys.some((k, i) => k !== (cur.keys[i] ?? "")))
      out.push(targetBak ? `没人接再打 ${targetKeys.filter(Boolean).map((k) => shown(k, masters)).join("、")}` : "不再拨备用号码");
    if ((masterId ?? "") !== (cfg.masterId ?? "")) out.push(master ? `所属主机改为 ${master.deviceName || master.sn}` : "不属于任何管理主机");
    if (type !== cur.type) out.push(`呼叫方式改为${lan ? "局域网" : "云对讲"}`);
    if (newSip) out.push(`本机 SIP 号设为 ${newSip.sipAccount}`);
    if (timeout !== null && timeout !== cur.timeout) out.push(`呼叫等待 ${timeout} 秒`);
    if (maxtime !== null && maxtime !== cur.maxtime) out.push(`单次通话最长 ${maxtime} 秒`);
    if (record !== (cur.record ?? 0)) out.push(record ? "打开通话录音" : "关闭通话录音");
    return out;
  }, [targetNumber, targetBak, targetKeys, masterId, cfg.masterId, master, type, lan, cur, newSip, timeout, maxtime, record, masters]);

  /** 主机的覆盖房间里加上雷达所在的房间，并下发通讯录 */
  async function addRoom() {
    if (!master || !d.roomId) return;
    setAdding(true);
    try {
      await addRoomToMaster({ id: master.id, sn: master.sn, orgId: d.orgId }, d.roomId);
      message.success(`已把${d.roomName ? `"${d.roomName}"` : "这个房间"}加到 ${master.deviceName || master.sn} 的覆盖房间，并下发通讯录`);
      setMasters(await getMasterOptions(d));
    } catch (e) {
      message.error(`加入覆盖房间失败：${errText(e)}`);
    } finally {
      setAdding(false);
    }
  }

  async function allocate() {
    try {
      const s = await getAvailableSip(d);
      if (!s.sipAccount) throw new Error("平台没有空闲的 SIP 账号");
      setNewSip(s);
    } catch (e) {
      message.error(`分配 SIP 号失败：${errText(e)}`);
    }
  }

  async function save() {
    const bad = [emergency, ...backups].map((t) => targetError(t, masters)).find(Boolean);
    if (!lan && bad) return message.warning(bad);
    if (!lan && !localSip) return message.warning("云对讲需要雷达自己的 SIP 号，先在“线路设置”里分配一个");
    setSaving(true);
    try {
      const call: Record<string, unknown> = { talk_type_sel: type, talk_master_number: targetNumber, talk_call_number_bak: targetBak };
      KEY_NAMES.forEach((k, i) => (call[k] = targetKeys[i] ?? ""));
      if (timeout !== null) call.talk_call_timeout = timeout;
      if (maxtime !== null) call.talk_local_maxtime = maxtime;
      // 不带的项平台按原值处理；SIP 账号只在新分配时带
      if (sipServer) call.talk_sip_server = sipServer;
      if (newSip) Object.assign(call, { talk_local_number: newSip.sipAccount, talk_auth_pass: newSip.sipPassword });
      const r1 = await awaitSet(() => saveRadarCallConfig(d, { masterId: masterId ?? null, call }));
      // 通话录音不在平台的通话配置里，单独写属性
      let r2: "ok" | "nochange" = "nochange";
      if (record !== (cur.record ?? 0)) r2 = await awaitSet(async () => Number(await writeDeviceProperties(d.sn, [{ propertyName: "call_record_EN", value: record }], false)));
      message.success(r1 === "nochange" && r2 === "nochange" ? "已保存，设备上的设置本来就是这样" : "已保存并下发，设备已应答");
      await load();
    } catch (e) {
      message.error(`保存失败：${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  /** 等设备对 set-property 的应答；平台返回 0 / -1 表示没有要下发的变化 */
  function awaitSet(send: () => Promise<number | undefined>) {
    return new Promise<"ok" | "nochange">((resolve, reject) => {
      let seq: string | undefined;
      const early: DeviceResponse[] = [];
      const off = realtime.on("DeviceResponse", (payload) => {
        const r = payload as DeviceResponse;
        if (r?.sn !== d.sn || r.command !== "set-property") return;
        if (seq === undefined) early.push(r);
        else take(r);
      });
      const timer = window.setTimeout(() => done(() => reject(new Error("已保存到平台，但 30 秒内设备没有应答"))), 30_000);
      function done(fn: () => void) {
        off();
        clearTimeout(timer);
        fn();
      }
      function take(r: DeviceResponse) {
        if (r.seq !== undefined && r.seq !== null && String(r.seq) !== seq) return;
        done(() => (isResponseOk(r.code) ? resolve("ok") : reject(new Error(`${r.message || "设备返回错误"}（code ${r.code}）`))));
      }
      send().then(
        (s) => {
          if (!s || s < 0) return done(() => resolve("nochange"));
          seq = String(s);
          early.forEach(take);
        },
        (e) => done(() => reject(e)),
      );
    });
  }

  if (loading)
    return (
      <div className="detail-body">
        <Spin />
      </div>
    );

  const blocked = d.isDisabled ? "设备已停用" : !online ? "设备离线，无法下发" : undefined;
  // 线路有问题时默认展开：局域网、没有本机 SIP 号
  const lineProblem = lan || !localSip;

  return (
    <div className="detail-body call-page">
      <div className="call-top">
        <span className="muted small">{reading ? "正在读设备…" : cur.from === "device" ? "按设备读回的显示" : "按平台记录显示"}</span>
        <Button size="small" type="text" icon={<ReloadOutlined />} disabled={saving || reading} onClick={load} title="重新读取" />
      </div>
      {blocked && <Alert type="warning" showIcon message={`${blocked}，改了也发不到设备`} />}

      {/* 1. 告警时打给谁 */}
      <div className="ops-card">
        <h2>告警时打给谁</h2>
        {lan ? (
          <p className="small" style={{ margin: 0 }}>
            现在是局域网模式：没有 SIP 服务器，告警时雷达只能直接呼叫管理主机（拨主机的 IP），打不了手机，也不会拨备用号码。要打手机，到下面"线路设置"改成云对讲。
          </p>
        ) : (
          <dl className="kv call-kv">
            <dt>紧急号码</dt>
            <dd>
              <TargetPicker value={emergency} onChange={setEmergency} masters={masters} />
            </dd>
            <dt>没人接再打</dt>
            <dd>
              <div className="call-keys">
                {backups.map((t, i) => (
                  <div key={i} className="call-key">
                    <span className="muted small">{i + 1}</span>
                    <TargetPicker value={t} onChange={(v) => setBackups((bs) => bs.map((x, j) => (j === i ? v : x)))} masters={masters} />
                    <Button size="small" type="text" icon={<DeleteOutlined />} title="删掉" onClick={() => setBackups((bs) => bs.filter((_, j) => j !== i))} />
                  </div>
                ))}
                {backups.length < 3 && (
                  <Button size="small" icon={<PlusOutlined />} style={{ alignSelf: "flex-start" }} onClick={() => setBackups((bs) => [...bs, { kind: "phone", value: "" }])}>
                    添加备用号码
                  </Button>
                )}
                {!backups.length && <span className="muted small">紧急号码 {timeout ?? cur.timeout ?? 30} 秒没人接就挂断。可以加最多 3 个备用号码依次拨，比如先打手机、没人接再呼主机。</span>}
              </div>
            </dd>
          </dl>
        )}
        <p className="small" style={{ margin: "10px 0 0" }}>
          {dialScenes === undefined ? (
            <span className="muted">正在看哪些告警会拨号…</span>
          ) : dialScenes.length ? (
            <>会拨号的告警：{dialScenes.join("、")}。</>
          ) : (
            <span className="err-text">还没有告警会拨号，号码设好也不会打。</span>
          )}
          {onGoAlarm && (
            <Button type="link" size="small" onClick={onGoAlarm} style={{ padding: "0 4px", height: "auto" }}>
              在告警配置里改
            </Button>
          )}
        </p>
      </div>

      {/* 2. 管理主机呼叫这台雷达 */}
      <div className="ops-card">
        <h2>
          管理主机呼叫这台雷达
          <span className="muted small" style={{ fontWeight: 400 }}>
            可选
          </span>
        </h2>
        <dl className="kv call-kv">
          <dt>所属主机</dt>
          <dd>
            <Select
              allowClear
              style={{ width: "100%", maxWidth: 380 }}
              placeholder={masters.length ? "不属于管理主机" : "机构里还没有管理主机"}
              value={masterId}
              onChange={setMasterId}
              options={masters.map((m) => ({
                value: m.id,
                label: [m.deviceName || m.sn, m.sipUserName ? `SIP ${m.sipUserName}` : "没有 SIP 号", m.covers ? "已覆盖本房间" : undefined].filter(Boolean).join(" · "),
              }))}
            />
            {master && master.covers && <div className="small muted">主机的通讯录里有这台雷达，主机上可以看到它的状态并主动呼叫。</div>}
            {master && !master.covers && d.roomId && (
              <div className="small err-text">
                这台主机的覆盖房间里没有{d.roomName ? `"${d.roomName}"` : "这台雷达的房间"}，主机看不到也打不过来。
                <Button size="small" type="link" loading={adding} onClick={addRoom} style={{ padding: "0 4px", height: "auto" }}>
                  加到覆盖房间
                </Button>
              </div>
            )}
            {master && !d.roomId && <div className="small muted">雷达还没绑定房间，主机通讯录按房间生成，绑定后才会出现在主机上。</div>}
          </dd>
        </dl>
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          主机呼叫雷达和告警打给谁是两回事：可以告警打手机，同时让主机能呼叫这台雷达。告警也要打到主机的话，把紧急号码或备用号码选成这台主机。
        </p>
      </div>

      {/* 3. 线路设置 */}
      <Collapse
        className="call-line"
        defaultActiveKey={lineProblem ? ["line"] : []}
        items={[
          {
            key: "line",
            label: (
              <span>
                线路设置
                <span className="muted small">
                  {" "}
                  · {lan ? "局域网" : "云对讲"}
                  {localSip ? ` · 本机 SIP ${localSip}` : " · 没有本机 SIP 号"}
                </span>
              </span>
            ),
            children: (
              <>
                {cur.type === 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <LanDiagnosis
                      d={d}
                      master={master}
                      masters={masters}
                      onUseCloud={() => {
                        setType(1);
                        message.info(localSip ? "已切到云对讲，确认后点“保存并下发”" : "已切到云对讲，还要先分配一个 SIP 号再保存");
                      }}
                    />
                  </div>
                )}
                <dl className="kv call-kv">
                  <dt>呼叫方式</dt>
                  <dd>
                    <Segmented
                      size="small"
                      value={type}
                      onChange={(v) => setType(Number(v))}
                      options={[
                        { value: 1, label: "云对讲（推荐）" },
                        { value: 0, label: "局域网" },
                      ]}
                    />
                    <div className="small muted">
                      {lan ? "不经过 SIP 服务器，雷达直接拨主机的 IP，主机 IP 变了或雷达拿不到主机 IP 就打不通" : "雷达和主机都注册到 SIP 服务器，按号码接通，能打手机"}
                    </div>
                  </dd>
                  <dt>本机 SIP</dt>
                  <dd>
                    {localSip ? <span className="mono">{localSip}</span> : <span className="muted">没有</span>}
                    {newSip && (
                      <Tag color="blue" style={{ marginLeft: 8 }}>
                        新分配，保存后生效
                      </Tag>
                    )}
                    {!localSip && (
                      <Button size="small" style={{ marginLeft: 8 }} onClick={allocate}>
                        分配 SIP 号
                      </Button>
                    )}
                    {sipServer && <span className="muted small"> · {sipServer}</span>}
                  </dd>
                  <dt>呼叫等待</dt>
                  <dd>
                    <InputNumber size="small" min={0} max={600} precision={0} suffix="秒" style={{ width: 120 }} value={timeout} onChange={setTimeoutSec} />
                    <span className="muted small"> 拨出后这么久没人接就挂断，再拨下一个号码</span>
                  </dd>
                  <dt>通话最长</dt>
                  <dd>
                    <InputNumber size="small" min={0} max={600} precision={0} suffix="秒" style={{ width: 120 }} value={maxtime} onChange={setMaxtime} />
                    <span className="muted small"> 到时间自动挂断</span>
                  </dd>
                  <dt>通话录音</dt>
                  <dd>
                    <Switch size="small" checked={!!record} onChange={(v) => setRecord(v ? 1 : 0)} />
                    <span className="muted small"> 接通的通话录音并上传到平台</span>
                  </dd>
                </dl>
              </>
            ),
          },
        ]}
      />

      <div className="call-save">
        <Button type="primary" loading={saving} disabled={!changes.length || !!blocked || reading} onClick={save}>
          保存并下发
        </Button>
        <span className="muted small">{changes.length ? changes.join("；") : "没有改动"}</span>
      </div>

      {/* 最近通话：改完配置后看效果 */}
      <div className="ops-card">
        <h2>最近通话</h2>
        <CallRecords sn={d.sn} sip={localSip} orgId={d.orgId} />
      </div>
    </div>
  );
}

function dropEmpty<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.every((x) => !x)))) as Partial<T>;
}
