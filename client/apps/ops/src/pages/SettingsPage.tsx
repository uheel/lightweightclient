import { useEffect, useState } from "react";
import { App, Button, Checkbox, Radio, Spin, Switch } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { ModuleName } from "../workspace/ModuleName";
import { ALERT_GROUPS } from "../api/device";
import { setPopupSettings, usePopupSettings } from "../alerts/popupSettings";
import { getOrgSettings, onWatchPushChanged, setNotifyWatch } from "../api/orgSettings";
import { getAlertTypeConfig, getAlertTypes, isOurAlertType, setWatchPush, watchPushOn, type AlertType, type AlertTypeConfig } from "../api/alertType";

/** 系统设置：告警弹窗开关；推送告警到护工手表（机构设置，存在平台）。工作台的类别和模块在"菜单设置"里改 */
export default function SettingsPage({ onOpen }: { onOpen: (k: "menus") => void }) {
  return (
    <div className="page">
      <div className="page-head">
        <h1><ModuleName k="settings" /></h1>
        {/* 菜单设置在工作台上隐藏后从这里进 */}
        <Button size="small" icon={<MenuOutlined />} onClick={() => onOpen("menus")} style={{ marginLeft: "auto" }}>
          <ModuleName k="menus" />
        </Button>
      </div>
      <AlertPopupCard />
      <WatchPushCard />
    </div>
  );
}

/** 告警弹窗：默认关闭；打开后有新告警时应用内右下角提醒，窗口不在前台时屏幕右下角弹窗、响提示音、任务栏闪烁 */
function AlertPopupCard() {
  const p = usePopupSettings();
  return (
    <div className="ops-card settings-popup">
      <h2>
        告警弹窗
        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
          打开后，当前机构有新告警时在右下角提醒；窗口最小化或切到别的程序时，在屏幕右下角弹窗、响提示音、任务栏闪烁。打开时已有的告警不提醒。只存在这台电脑上
        </span>
      </h2>
      <div className="settings-popup-row">
        <Switch checked={p.enabled} onChange={(enabled) => setPopupSettings({ enabled })} />
        <span>{p.enabled ? "已开启" : "已关闭"}</span>
      </div>
      <div className="settings-popup-row">
        <span>提醒哪些告警</span>
        <Checkbox.Group
          disabled={!p.enabled}
          value={p.groups}
          options={ALERT_GROUPS}
          onChange={(groups) => setPopupSettings({ groups: groups as number[] })}
        />
        {p.enabled && !p.groups.length && <span className="muted">一类都没选，不会提醒</span>}
      </div>
    </div>
  );
}

type WatchMode = "off" | "all" | "some";

/**
 * 推送告警到护工手表，三选一：不推送 / 全部告警（机构总开关）/ 指定告警（总开关关，在下面直接勾告警类型，
 * 写到各告警类型的配置里，不用再去平台的告警事件类型一个个开）。只列备注带 goodlife 的告警类型。
 * 存在平台、按机构；切换机构时页面重新挂载、重新读
 */
function WatchPushCard() {
  const { message, modal } = App.useApp();
  const [all, setAll] = useState<boolean>();
  const [types, setTypes] = useState<AlertType[]>([]);
  const [cfg, setCfg] = useState<Map<string, AlertTypeConfig>>(new Map());
  /** 选了"指定告警"但还没勾任何一种：只是界面状态 */
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    // 连着改几次会连着重读，只用最后一次的结果，免得先发的读取后回来盖掉新的勾选
    let seq = 0;
    const load = () =>
      (async () => {
        const my = ++seq;
        const [s, list] = await Promise.all([getOrgSettings(), getAlertTypes()]);
        const ours = list.filter(isOurAlertType);
        const cfgs = await Promise.all(ours.map((t) => getAlertTypeConfig(t.id).catch(() => undefined)));
        if (my !== seq) return;
        setTypes(ours);
        setCfg(new Map(cfgs.filter((c): c is AlertTypeConfig => !!c).map((c) => [c.alertTypeId, c])));
        setAll(!!s.alertSettings?.enableNotifyWatch);
      })().catch((e) => message.error(`读取推送设置失败：${e.message}`));
    load();
    // 设备的告警配置里也能勾，那边改了这里重新读
    return onWatchPushChanged(load);
  }, []);

  const picked = types.filter((t) => watchPushOn(cfg.get(t.id)));
  const mode: WatchMode | undefined = all === undefined ? undefined : all ? "all" : picked.length || picking ? "some" : "off";

  /** 关掉所有单独开的告警类型 */
  async function clearPicked() {
    for (const t of picked) {
      const c = await setWatchPush(t.id, false);
      setCfg((m) => new Map(m).set(t.id, c));
    }
  }

  async function changeMode(m: WatchMode) {
    if (m === mode) return;
    const run = async () => {
      setBusy("mode");
      try {
        if (m === "all") await setNotifyWatch(true);
        else {
          if (all) await setNotifyWatch(false);
          if (m === "off") await clearPicked();
        }
        setAll(m === "all");
        setPicking(m === "some");
        message.success(m === "off" ? "已关闭推送告警到护工手表" : m === "all" ? "所有告警都会推送到护工手表" : "在下面勾选要推送到护工手表的告警");
      } catch (e) {
        message.error(`保存失败：${(e as Error).message}`);
      } finally {
        setBusy(undefined);
      }
    };
    if (m === "off" && picked.length)
      modal.confirm({ title: "不推送告警到护工手表？", content: `已勾选的 ${picked.length} 种告警会一起取消。`, okText: "不推送", onOk: run });
    else run();
  }

  async function toggle(t: AlertType, on: boolean) {
    setBusy(t.id);
    try {
      const c = await setWatchPush(t.id, on);
      setCfg((m) => new Map(m).set(t.id, c));
      setPicking(true);
    } catch (e) {
      message.error(`保存失败：${(e as Error).message}`);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="ops-card settings-popup">
      <h2>
        推送告警到护工手表
        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
          推送到的告警会在护工手表上弹窗。存在平台上，按机构设置，和网页端系统设置、告警事件类型里的是同一份
        </span>
      </h2>
      <div className="settings-popup-row">
        <Radio.Group
          optionType="button"
          value={mode}
          disabled={mode === undefined || !!busy}
          onChange={(e) => changeMode(e.target.value)}
          options={[
            { value: "off", label: "不推送" },
            { value: "all", label: "全部告警" },
            { value: "some", label: "指定告警" },
          ]}
        />
        {(mode === undefined || busy === "mode") && <Spin size="small" />}
        {mode === "some" && <span className="muted">已选 {picked.length} 种{picked.length ? "" : "，勾选前不会推送"}</span>}
      </div>
      {mode === "some" && (
        <>
          {ALERT_GROUPS.map((g) => {
            const list = types.filter((t) => t.alertTypeGroup === g.value);
            if (!list.length) return null;
            return (
              <div key={g.value} className="settings-popup-row" style={{ alignItems: "flex-start" }}>
                <span className="muted" style={{ width: 64, flex: "none" }}>{g.label}</span>
                <span style={{ flex: 1, display: "flex", flexWrap: "wrap", rowGap: 6 }}>
                  {list.map((t) => (
                    <Checkbox key={t.id} checked={watchPushOn(cfg.get(t.id))} disabled={!!busy || !cfg.has(t.id)} onChange={(e) => toggle(t, e.target.checked)}>
                      {t.alertTypeName}
                      {busy === t.id && <Spin size="small" style={{ marginLeft: 4 }} />}
                    </Checkbox>
                  ))}
                </span>
              </div>
            );
          })}
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            勾选后这类告警的微信、App、Web 弹窗推送改成按它自己的设置（勾选时照机构设置抄一份，所以现在没变化）；之后在平台改机构的这几项，勾选的告警不会跟着变，取消勾选后恢复跟机构走。
          </p>
        </>
      )}
    </div>
  );
}
