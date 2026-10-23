import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Checkbox, InputNumber, Select, Spin, Switch, Tag, Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { awaitDeviceResponse, getStoredProperties, readDeviceProperties, type Radar, type StoredProperty } from "../api/device";
import { getMasterOptions, getRadarCallConfig, type MasterOption } from "../api/master";
import { isMobileNumber, toShownNumber } from "./dialNumber";
import {
  fillVoiceIds,
  getDeviceScenes,
  getRoomLayouts,
  getSceneIssueStatus,
  getSceneTemplates,
  getTemplateScene,
  mergeDeviceScenes,
  RANGE_TYPE,
  readDeviceScenes,
  saveDeviceScenes,
  SPACE_TYPE,
  waitIssued,
  type LayoutRange,
  type RadarLayout,
  type Scene,
} from "../api/scene";
import { callsMaster, durationOf, maxMinutes, pickTemplates, playsAudio, templateAreaValues, toggleScene, tplKey } from "../scenes/plan";
import { parseArray } from "../rooms/qinglan";

/**
 * 告警配置：单台设备上常用告警的开关，不用走批量场景。
 * 开 = 把模板场景加进设备场景列表，关 = 去掉；其他场景原样带回（保存是整体覆盖，规则同批量场景）。
 */

interface AlarmDef {
  label: string;
  /** 模板 / 设备场景里可能用的名字，第一个有模板的为准（2026-10-16 平台模板：离床告警、床上坐起、疑似跌倒、跌倒告警；还没有滞留类模板，建好后按名字自动接上） */
  names: string[];
  desc: string;
  /** 涉及区域时用哪个：bed 自动用监护床，pick 让用户选 */
  area?: "bed" | "pick";
  /** 要设持续时间（分钟）时的默认值：条件持续满足这么久才告警 */
  duration?: number;
  /** 可选的"离开多久后告警"（分钟）：不填 = 一离开就告警（模板原样）；填了 = 离开后这么久还没回到区域才告警 */
  leaveDelay?: boolean;
}

const ALARMS: AlarmDef[] = [
  { label: "离床告警", names: ["离床告警", "离床报警"], desc: "离开监护床；可设离开多久还没回来才告警", area: "bed", leaveDelay: true },
  { label: "床上坐起告警", names: ["床上坐起告警", "床上坐起", "坐起告警"], desc: "在监护床上坐起", area: "bed" },
  { label: "疑似跌倒", names: ["疑似跌倒", "疑似跌倒告警"], desc: "检测到疑似跌倒，尽快查看" },
  { label: "跌倒告警", names: ["跌倒告警", "跌倒报警", "确认跌倒"], desc: "确认跌倒" },
  { label: "房间滞留告警", names: ["房间滞留告警", "房间滞留"], desc: "在房间内停留过久" },
  { label: "区域滞留告警", names: ["区域滞留告警", "区域滞留"], desc: "在指定区域停留过久", area: "pick" },
  // 2026-10-21 平台模板：6 型、13 型有（坐姿 + 最近几条区域都是 {{area}}），15 型没有
  { label: "久坐提醒", names: ["久坐提醒"], desc: "在选定区域坐着超过设定时间", area: "pick", duration: 30 },
];

/** 平台记录的值可能是 JSON 字符串 */
const parseObject = (v: unknown) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * 安装设置里的区域（属性 QL_radar_area：[[区域 ID, 类型, 8 个角], …]，场景里的区域编号就是这个 ID）。
 * 名字从同一份安装设置的 QL_radar_design（整份布置，ranges 按位置 = 区域 ID）取，没有时按区域 ID 用房间布置里的。
 */
function zonesFromProps(values: Record<string, StoredProperty>, layout?: RadarLayout): LayoutRange[] {
  const named = (parseObject(values.QL_radar_design?.value) as { ranges?: { text?: string; spaceType?: number }[] } | undefined)?.ranges;
  return (parseArray(values.QL_radar_area?.value) ?? [])
    .map((row) => parseArray(row))
    .filter((r): r is unknown[] => !!r && r.length >= 2)
    .map((r) => {
      const index = Number(r[0]);
      const n = named?.[index] ?? layout?.ranges.find((x) => x.index === index);
      return { index, type: Number(r[1]), text: n?.text, spaceType: n?.spaceType };
    });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const rangeText = (r: LayoutRange) =>
  `区域 ${r.index} · ${r.text || (r.spaceType !== undefined && SPACE_TYPE[r.spaceType]) || RANGE_TYPE[r.type] || `类型 ${r.type}`}`;

interface Row {
  def: AlarmDef;
  /** 这个型号用的模板 */
  tpl?: { name: string; id: string };
  /** 设备上已启用的同名场景 */
  current?: Scene;
}

export default function AlarmTab({
  d,
  online,
  callable,
  onGoCall,
}: {
  d: Radar;
  online: boolean;
  /** 这个型号能通话：每种告警可以选触发时呼叫管理主机 */
  callable?: boolean;
  /** 跳到通话页选所属管理主机 */
  onGoCall?: () => void;
}) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [tpls, setTpls] = useState<Map<string, { name: string; id: string }>>(new Map());
  const [defs, setDefs] = useState<Map<string, Scene>>(new Map());
  const [layout, setLayout] = useState<RadarLayout>();
  /** 安装设置（设备属性）里的区域 */
  const [propZones, setPropZones] = useState<LayoutRange[]>([]);
  /** 区域滞留、久坐选的区域（未开启时用） */
  const [pick, setPick] = useState<Record<string, number>>({});
  /** 输入框里改过、还没下发的持续时间（分钟） */
  const [dur, setDur] = useState<Record<string, number | null>>({});
  /** 所属管理主机（通话页选的）；undefined = 没选 */
  const [master, setMaster] = useState<MasterOption>();
  /** 紧急号码和呼叫方式："拨紧急号码"动作拨的就是它（先用平台记录，在线时读设备的现值） */
  const [emergency, setEmergency] = useState<{ number: string; type?: number }>({ number: "" });
  /** 未开启的告警勾的"拨紧急号码"，开启时带上 */
  const [pendingCall, setPendingCall] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<{ label: string; ok: boolean; text?: string }>();
  /** 设备上的场景是否已读回并合并；extra = 只在设备上有、平台没记录的场景数 */
  const [deviceRead, setDeviceRead] = useState<{ state: "skip" | "reading" | "ok" | "fail"; text?: string; extra?: number }>({ state: "skip" });

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const [all, current, layouts, props, mine] = await Promise.all([
        getSceneTemplates(),
        getDeviceScenes(d.id),
        d.roomId ? getRoomLayouts(d.roomId).catch(() => undefined) : undefined,
        getStoredProperties(d.sn).catch(() => ({}) as Record<string, StoredProperty>),
        callable ? Promise.all([getRadarCallConfig(d), getMasterOptions(d)]).catch(() => undefined) : undefined,
      ]);
      // 平台不一定记了 masterId：没记时按紧急号码对上主机的 SIP 号
      const number = String(props.talk_master_number?.value ?? "");
      const type = props.talk_type_sel?.value;
      setEmergency({ number, type: type === undefined || type === null || type === "" ? undefined : Number(type) });
      setMaster(mine?.[1].find((o) => (mine[0].masterId ? o.id === mine[0].masterId : !!o.sipUserName && o.sipUserName === number)));
      if (callable && online && !d.isDisabled) readEmergency(mine?.[1] ?? [], mine?.[0].masterId);
      const picked = pickTemplates(all);
      const m = new Map<string, { name: string; id: string }>();
      for (const a of ALARMS) {
        const name = a.names.find((n) => picked.has(tplKey(d.deviceType, n)));
        if (name) m.set(a.label, { name, id: picked.get(tplKey(d.deviceType, name))!.id });
      }
      const sc = new Map<string, Scene>();
      await Promise.all(
        [...m].map(async ([label, t]) => {
          const s = await getTemplateScene(t.id);
          if (s) sc.set(label, s);
        }),
      );
      setTpls(m);
      setDefs(sc);
      setScenes(current);
      const lay = layouts?.get(d.sn);
      setLayout(lay);
      setPropZones(zonesFromProps(props, lay));
      setDur({});
      setLoading(false);
      readDevice(current);
    } catch (e) {
      setError(errText(e));
      setLoading(false);
    }
  }

  /** 平台记录可能和设备不一致（在设备属性里改过、别处改过），在线时读设备上的紧急号码和呼叫方式 */
  async function readEmergency(options: MasterOption[], masterId?: string) {
    try {
      const v = await awaitDeviceResponse<Record<string, unknown>>(d.sn, "get-property", () => readDeviceProperties(d.sn, ["talk_master_number", "talk_type_sel"]));
      const number = String(v?.talk_master_number ?? "");
      const t = v?.talk_type_sel;
      setEmergency({ number, type: t === undefined || t === null || t === "" ? undefined : Number(t) });
      if (!masterId) setMaster(options.find((o) => !!o.sipUserName && o.sipUserName === number));
    } catch {
      /* 读不到就用平台记录 */
    }
  }

  /** 平台记录不一定是设备上的（删了设备再添加时新 id 下没有记录），在线时再读一次设备，按场景名合并 */
  async function readDevice(platform: Scene[]) {
    if (!online || d.isDisabled) return setDeviceRead({ state: "skip" });
    setDeviceRead({ state: "reading" });
    try {
      const merged = await fillVoiceIds(mergeDeviceScenes(platform, await readDeviceScenes(d.sn)), platform, d.id);
      setScenes(merged);
      setDeviceRead({ state: "ok", extra: merged.length - platform.length });
    } catch (e) {
      setDeviceRead({ state: "fail", text: errText(e) });
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id, callable]);

  const active = useMemo(() => scenes.filter((s) => !s.isDisabled), [scenes]);
  const rows: Row[] = ALARMS.map((def) => ({
    def,
    tpl: tpls.get(def.label),
    current: active.find((s) => def.names.includes(s.sceneName)),
  }));
  const others = active.filter((s) => !ALARMS.some((a) => a.names.includes(s.sceneName))).length;

  // 区域以安装设置为准，没读到时用房间布置
  const ranges = propZones.length ? propZones : (layout?.ranges ?? []);
  const bed = ranges.find((r) => r.type === 5);
  // 能选的区域：干扰区不算
  const areaOptions = ranges.filter((r) => r.type !== 3).map((r) => ({ value: r.index, label: rangeText(r) }));

  /** 已开启场景里的区域编号 */
  const areaOf = (s?: Scene) => {
    const v = s ? templateAreaValues(s).find((x) => /^-?\d+$/.test(x)) : undefined;
    return v === undefined ? undefined : Number(v);
  };

  /** 开启时用的区域；undefined 且需要区域 = 不能开启，附原因 */
  function areaFor(r: Row): { area?: number; need: boolean; why?: string } {
    const tpl = defs.get(r.def.label);
    if (!tpl || !templateAreaValues(tpl).length) return { need: false };
    if (!ranges.length) return { need: true, why: "安装设置里还没有区域划分" };
    if (r.def.area === "bed") return bed ? { area: bed.index, need: true } : { need: true, why: "区域划分里没有监护床" };
    if (r.def.area === "pick") {
      const v = pick[r.def.label] ?? areaOf(r.current);
      return v !== undefined ? { area: v, need: true } : { need: true, why: areaOptions.length ? "先选区域" : "区域划分里没有可选的区域" };
    }
    return { need: true, why: "模板涉及区域，但不知道该对应哪种区域" };
  }

  /** 开启时用的持续时间：输入框里改的 > 设备上现在的 > 默认 */
  // 13 型最多 10 分钟（每人 600 条记录），默认值也不能超过
  const maxMin = maxMinutes(d.deviceType);
  const defaultMinutes = (r: Row) => (r.def.duration === undefined ? undefined : Math.min(r.def.duration, maxMin));
  /** 离开多久后告警：输入框清空 = 不延迟，所以不能用 ?? 往后退 */
  const durationFor = (r: Row) =>
    r.def.leaveDelay
      ? r.def.label in dur
        ? (dur[r.def.label] ?? undefined)
        : r.current && durationOf(r.current)
      : r.def.duration === undefined
        ? undefined
        : (dur[r.def.label] ?? (r.current && durationOf(r.current)) ?? defaultMinutes(r));
  const hasMinutes = (r: Row) => r.def.duration !== undefined || !!r.def.leaveDelay;
  /** 13 型不收超时类型场景，离开多久表达不了（久坐那种"待够"可以用加长记录数） */
  const noLeaveDelay = d.deviceType === 13 ? "13 型不收延迟（超时类型）场景，只能一离开就告警" : undefined;

  /**
   * 开启时要不要拨紧急号码：勾选框里改的 > 设备上现在的。
   * 场景动作叫"呼叫管理主机"（Service_call_master），实际是拨紧急号码，号码是手机号、主机或别的 SIP 号都行
   */
  const callFor = (r: Row) => pendingCall[r.def.label] ?? callsMaster(r.current);
  /** 不能勾"拨紧急号码"的原因（取消勾选总是可以） */
  function callBlock(r: Row) {
    if (playsAudio(defs.get(r.def.label)) || playsAudio(r.current)) return "这个告警会播放提示音，平台规定播放音频和拨号只能二选一";
    if (!emergency.number) return "紧急号码是空的，先到“通话”页设置";
  }
  const isPhone = isMobileNumber(emergency.number);
  /** 紧急号码是什么：所属主机 / 手机 / SIP 号 */
  const emergencyText =
    master && master.sipUserName === emergency.number ? `主机 ${master.deviceName || master.sn}` : isPhone ? "手机" : emergency.type === 0 ? "局域网模式下号码基本不起作用" : "SIP 号";

  async function apply(r: Row, on: boolean, area?: number, duration = durationFor(r), call = callFor(r)) {
    const tpl = defs.get(r.def.label);
    const t = tpls.get(r.def.label);
    setBusy(r.def.label);
    setResult(undefined);
    try {
      const list = toggleScene(
        scenes,
        r.def.names,
        on && tpl && t
          ? { name: t.name, scene: tpl, area, duration: duration ?? undefined, mode: r.def.leaveDelay ? "leave" : "stay", deviceType: d.deviceType, callMaster: callable ? call && !playsAudio(tpl) : undefined }
          : undefined,
      );
      const before = (await getSceneIssueStatus(d.id)).sceneIssueAt;
      await saveDeviceScenes(d.sn, list);
      const s = await waitIssued(d.id, before);
      setResult({ label: r.def.label, ok: s.status === "ok", text: s.text });
      if (s.status === "ok") message.success(`${r.def.label}已${on ? "开启" : "关闭"}`);
      // 平台记录已保存，无论设备是否应答都重新读一次
      setScenes(await getDeviceScenes(d.id));
      setDur(({ [r.def.label]: _, ...rest }) => rest);
      setPendingCall(({ [r.def.label]: _, ...rest }) => rest);
    } catch (e) {
      setResult({ label: r.def.label, ok: false, text: errText(e) });
    } finally {
      setBusy(undefined);
    }
  }

  /** 已开启时改了持续时间：直接重新下发（离开多久清空 = 改回一离开就告警） */
  function commitDuration(r: Row, area?: number) {
    if (!(r.def.label in dur) || !r.current || busy) return;
    const v = dur[r.def.label] ?? undefined;
    if ((v === undefined && !r.def.leaveDelay) || v === durationOf(r.current)) return;
    apply(r, true, area, v);
  }

  // 设备上的场景没读回来之前不让开关：保存是整体覆盖，会把只在设备上的场景删掉
  const blocked = d.isDisabled ? "设备已停用" : !online ? "设备离线，无法下发" : deviceRead.state === "reading" ? "正在读设备上的场景" : undefined;

  if (loading)
    return (
      <div className="detail-body">
        <Spin />
      </div>
    );

  return (
    <div className="detail-body">
      <div className="ops-card" data-spot="alarm">
        <h2>
          常用告警
          <Button size="small" type="text" icon={<ReloadOutlined />} disabled={!!busy} onClick={load} title="重新读取" style={{ marginLeft: "auto" }} />
        </h2>
        {error && <Alert type="error" showIcon style={{ marginBottom: 10 }} message={`读取失败：${error}`} />}
        {blocked && deviceRead.state !== "reading" && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message={`${blocked}，开关暂不可用`} />}
        {deviceRead.state === "reading" && (
          <p className="muted small" style={{ marginBottom: 10 }}>
            <Spin size="small" /> 正在读设备上的场景，读回后再开关…
          </p>
        )}
        {deviceRead.state === "fail" && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 10 }}
            message={`没读到设备上的场景（${deviceRead.text}），下面按平台记录显示；设备上另有的场景，开关时会被覆盖掉`}
          />
        )}
        {deviceRead.state === "ok" && !!deviceRead.extra && (
          <p className="muted small" style={{ marginBottom: 10 }}>
            设备上有 {deviceRead.extra} 个场景平台没有记录（例如删掉设备后重新添加），已按设备读回的显示，开关时会一起保存到平台。
          </p>
        )}
        <ul className="alarm-list">
          {rows.map((r) => {
            const on = !!r.current;
            const a = areaFor(r);
            const curArea = areaOf(r.current);
            const noTpl = !r.tpl ? `平台上还没有这个型号的"${r.def.label}"模板` : !defs.get(r.def.label) ? "读取模板失败" : undefined;
            const why = blocked ?? (on ? undefined : noTpl ?? a.why);
            const isBusy = busy === r.def.label;
            return (
              <li key={r.def.label} className={[noTpl && !on && "muted", hasMinutes(r) && "wide"].filter(Boolean).join(" ") || undefined}>
                <div className="alarm-name">
                  <b>{r.def.label}</b>
                  {r.current && r.current.sceneName !== (r.tpl?.name ?? r.def.label) && (
                    <Tag bordered={false}>{r.current.sceneName}</Tag>
                  )}
                  <small>{noTpl && !on ? noTpl : r.def.desc}</small>
                </div>
                <div className="alarm-area">
                  {r.def.leaveDelay && (
                    <Tooltip title={noLeaveDelay ?? "不填 = 一离开就告警；填了 = 离开后这么久还没回到监护床才告警，中途回来就不告警"}>
                      <InputNumber
                        size="small"
                        style={{ width: 170 }}
                        min={1}
                        max={maxMin}
                        precision={0}
                        prefix="离开"
                        suffix="分钟后"
                        placeholder="立即"
                        disabled={!!blocked || !!busy || !!noLeaveDelay}
                        value={r.def.label in dur ? dur[r.def.label] : ((r.current && durationOf(r.current)) ?? null)}
                        onChange={(v) => setDur((m) => ({ ...m, [r.def.label]: v }))}
                        onBlur={() => commitDuration(r, a.area)}
                        onPressEnter={() => commitDuration(r, a.area)}
                      />
                    </Tooltip>
                  )}
                  {r.def.duration !== undefined && (
                    <InputNumber
                      size="small"
                      style={{ width: 150 }}
                      min={1}
                      max={maxMin}
                      precision={0}
                      prefix="超过"
                      suffix="分钟"
                      placeholder={String(defaultMinutes(r))}
                      disabled={!!blocked || !!busy}
                      value={dur[r.def.label] !== undefined ? dur[r.def.label] : on ? ((r.current && durationOf(r.current)) ?? null) : defaultMinutes(r)}
                      onChange={(v) => setDur((m) => ({ ...m, [r.def.label]: v }))}
                      onBlur={() => commitDuration(r, a.area)}
                      onPressEnter={() => commitDuration(r, a.area)}
                    />
                  )}
                  {r.def.area === "pick" && a.need && areaOptions.length > 0 ? (
                    <Select
                      size="small"
                      style={{ width: 180 }}
                      placeholder="选区域"
                      disabled={!!blocked || !!busy}
                      value={pick[r.def.label] ?? curArea}
                      options={areaOptions}
                      onChange={(v) => {
                        setPick((p) => ({ ...p, [r.def.label]: v }));
                        // 已开启时换区域直接重新下发
                        if (on && v !== curArea) apply(r, true, v);
                      }}
                    />
                  ) : on && curArea !== undefined ? (
                    <span className="small muted">
                      {layout?.ranges.find((x) => x.index === curArea) ? rangeText(layout.ranges.find((x) => x.index === curArea)!) : `区域 ${curArea}`}
                    </span>
                  ) : a.need && a.area !== undefined ? (
                    <span className="small muted">{bed && a.area === bed.index ? `监护床 = 区域 ${bed.index}` : `区域 ${a.area}`}</span>
                  ) : null}
                  {callable && (
                    <Tooltip title={callFor(r) ? undefined : callBlock(r)}>
                      <Checkbox
                        checked={callFor(r)}
                        disabled={!!blocked || !!busy || (!callFor(r) && !!callBlock(r))}
                        onChange={(e) => {
                          const v = e.target.checked;
                          // 已开启时直接重新下发，未开启的记下来，开启时带上
                          if (on) apply(r, true, a.area, undefined, v);
                          else setPendingCall((p) => ({ ...p, [r.def.label]: v }));
                        }}
                      >
                        <span className="small">拨紧急号码</span>
                      </Checkbox>
                    </Tooltip>
                  )}
                </div>
                <Tooltip title={why}>
                  <Switch
                    checked={on}
                    loading={isBusy}
                    disabled={!!why || (!!busy && !isBusy)}
                    onChange={(v) => apply(r, v, a.area)}
                  />
                </Tooltip>
              </li>
            );
          })}
        </ul>
        {result && (
          <p className={`small ${result.ok ? "muted" : "err-text"}`} style={{ marginTop: 10 }}>
            {result.label}：{result.ok ? `设备已应答（${result.text}）` : `下发失败：${result.text}`}
          </p>
        )}
        {callable && (
          <p className="muted small" style={{ marginTop: 10 }}>
            {emergency.number ? (
              <>
                紧急号码 <span className="mono">{toShownNumber(emergency.number)}</span>（{emergencyText}）。勾了"拨紧急号码"的告警触发时，雷达拨这个号码
                {emergency.type !== 0 && emergency.number === "123456" ? (
                  <span className="err-text">；但 123456 是出厂默认号码，云对讲下拨不通任何人，先到通话页设好</span>
                ) : emergency.type === 0 && isPhone ? (
                  <span className="err-text">；但现在是局域网模式，没有 SIP 服务器，打不了手机，要改成云对讲</span>
                ) : emergency.type === 0 ? (
                  "，局域网模式下实际是直接拨主机的 IP"
                ) : (
                  ""
                )}
                。
              </>
            ) : (
              <>紧急号码是空的，告警时没法拨号。</>
            )}
            <Button type="link" size="small" onClick={onGoCall} style={{ padding: "0 4px", height: "auto" }}>
              {emergency.number ? "改通话设置" : "去设置"}
            </Button>
          </p>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>
          开启时按场景模板的默认设置下发；久坐提醒另按选的区域和时长下发，坐着持续超过这么久才提醒；离床告警填了"离开多久"时，离开监护床这么久还没回来才告警（设备自己计时，不填就一离开就告警）{others > 0 ? `；设备上另有 ${others} 个场景，开关这里的告警不会影响它们` : ""}。需要改条件、批量操作多台设备时用"批量场景"。
        </p>
      </div>
    </div>
  );
}
