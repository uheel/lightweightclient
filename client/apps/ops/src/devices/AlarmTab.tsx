import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Select, Spin, Switch, Tag, Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { Radar } from "../api/device";
import {
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
import { pickTemplates, templateAreaValues, toggleScene, tplKey } from "../scenes/plan";

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
}

const ALARMS: AlarmDef[] = [
  { label: "离床告警", names: ["离床告警", "离床报警"], desc: "离开监护床超过设定时间", area: "bed" },
  { label: "床上坐起告警", names: ["床上坐起告警", "床上坐起", "坐起告警"], desc: "在监护床上坐起", area: "bed" },
  { label: "疑似跌倒", names: ["疑似跌倒", "疑似跌倒告警"], desc: "检测到疑似跌倒，尽快查看" },
  { label: "跌倒告警", names: ["跌倒告警", "跌倒报警", "确认跌倒"], desc: "确认跌倒" },
  { label: "房间滞留告警", names: ["房间滞留告警", "房间滞留"], desc: "在房间内停留过久" },
  { label: "区域滞留告警", names: ["区域滞留告警", "区域滞留"], desc: "在指定区域停留过久", area: "pick" },
];

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

export default function AlarmTab({ d, online }: { d: Radar; online: boolean }) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [tpls, setTpls] = useState<Map<string, { name: string; id: string }>>(new Map());
  const [defs, setDefs] = useState<Map<string, Scene>>(new Map());
  const [layout, setLayout] = useState<RadarLayout>();
  /** 区域滞留选的区域（未开启时用） */
  const [pick, setPick] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<{ label: string; ok: boolean; text?: string }>();
  /** 设备上的场景是否已读回并合并；extra = 只在设备上有、平台没记录的场景数 */
  const [deviceRead, setDeviceRead] = useState<{ state: "skip" | "reading" | "ok" | "fail"; text?: string; extra?: number }>({ state: "skip" });

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const [all, current, layouts] = await Promise.all([
        getSceneTemplates(),
        getDeviceScenes(d.id),
        d.roomId ? getRoomLayouts(d.roomId).catch(() => undefined) : undefined,
      ]);
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
      setLayout(layouts?.get(d.sn));
      setLoading(false);
      readDevice(current);
    } catch (e) {
      setError(errText(e));
      setLoading(false);
    }
  }

  /** 平台记录不一定是设备上的（删了设备再添加时新 id 下没有记录），在线时再读一次设备，按场景名合并 */
  async function readDevice(platform: Scene[]) {
    if (!online || d.isDisabled) return setDeviceRead({ state: "skip" });
    setDeviceRead({ state: "reading" });
    try {
      const merged = mergeDeviceScenes(platform, await readDeviceScenes(d.sn));
      setScenes(merged);
      setDeviceRead({ state: "ok", extra: merged.length - platform.length });
    } catch (e) {
      setDeviceRead({ state: "fail", text: errText(e) });
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id]);

  const active = useMemo(() => scenes.filter((s) => !s.isDisabled), [scenes]);
  const rows: Row[] = ALARMS.map((def) => ({
    def,
    tpl: tpls.get(def.label),
    current: active.find((s) => def.names.includes(s.sceneName)),
  }));
  const others = active.filter((s) => !ALARMS.some((a) => a.names.includes(s.sceneName))).length;

  const bed = layout?.ranges.find((r) => r.type === 5);
  // 能选的区域：干扰区不算
  const areaOptions = (layout?.ranges ?? []).filter((r) => r.type !== 3).map((r) => ({ value: r.index, label: rangeText(r) }));

  /** 已开启场景里的区域编号 */
  const areaOf = (s?: Scene) => {
    const v = s ? templateAreaValues(s).find((x) => /^-?\d+$/.test(x)) : undefined;
    return v === undefined ? undefined : Number(v);
  };

  /** 开启时用的区域；undefined 且需要区域 = 不能开启，附原因 */
  function areaFor(r: Row): { area?: number; need: boolean; why?: string } {
    const tpl = defs.get(r.def.label);
    if (!tpl || !templateAreaValues(tpl).length) return { need: false };
    if (!layout) return { need: true, why: d.roomId ? "房间布局里没有这台雷达" : "设备未绑定房间" };
    if (r.def.area === "bed") return bed ? { area: bed.index, need: true } : { need: true, why: "户型里没有监护床" };
    if (r.def.area === "pick") {
      const v = pick[r.def.label] ?? areaOf(r.current);
      return v !== undefined ? { area: v, need: true } : { need: true, why: areaOptions.length ? "先选区域" : "户型里没有区域" };
    }
    return { need: true, why: "模板涉及区域，但不知道该对应哪种区域" };
  }

  async function apply(r: Row, on: boolean, area?: number) {
    const tpl = defs.get(r.def.label);
    const t = tpls.get(r.def.label);
    setBusy(r.def.label);
    setResult(undefined);
    try {
      const list = toggleScene(scenes, r.def.names, on && tpl && t ? { name: t.name, scene: tpl, area } : undefined);
      const before = (await getSceneIssueStatus(d.id)).sceneIssueAt;
      await saveDeviceScenes(d.sn, list);
      const s = await waitIssued(d.id, before);
      setResult({ label: r.def.label, ok: s.status === "ok", text: s.text });
      if (s.status === "ok") message.success(`${r.def.label}已${on ? "开启" : "关闭"}`);
      // 平台记录已保存，无论设备是否应答都重新读一次
      setScenes(await getDeviceScenes(d.id));
    } catch (e) {
      setResult({ label: r.def.label, ok: false, text: errText(e) });
    } finally {
      setBusy(undefined);
    }
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
              <li key={r.def.label} className={noTpl && !on ? "muted" : undefined}>
                <div className="alarm-name">
                  <b>{r.def.label}</b>
                  {r.current && r.current.sceneName !== (r.tpl?.name ?? r.def.label) && (
                    <Tag bordered={false}>{r.current.sceneName}</Tag>
                  )}
                  <small>{noTpl && !on ? noTpl : r.def.desc}</small>
                </div>
                <div className="alarm-area">
                  {r.def.area === "pick" && a.need && areaOptions.length > 0 ? (
                    <Select
                      size="small"
                      style={{ width: 200 }}
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
        <p className="muted small" style={{ marginTop: 10 }}>
          开启时按场景模板的默认设置下发{others > 0 ? `；设备上另有 ${others} 个场景，开关这里的告警不会影响它们` : ""}。需要改条件、批量操作多台设备时用"批量场景"。
        </p>
      </div>
    </div>
  );
}
