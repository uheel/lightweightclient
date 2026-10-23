import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Modal, Spin } from "antd";
import { EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import { realtime } from "@radar/core";
import type { DeviceResponse } from "../../api/device";
import { applyMasterSip, disableMasterSip, previewMasterSip, testSipAccount, type Master, type SipPreview } from "../../api/master";

/**
 * 管理主机的 SIP 账号：启用 / 更换 / 停用，流程同平台管理主机页。
 * 启用、更换：平台先挑一个空闲账号给你看（可以换一个、测试能不能注册），确定后绑定并下发给主机，
 * 主机执行完回一条 command = "sipaccount" 的设备应答；停用：平台解除绑定并通知主机
 */

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sameId = (a?: string, b?: string) => !!a && !!b && a.replace(/-/g, "").toLowerCase() === b.replace(/-/g, "").toLowerCase();

/** 等主机对 SIP 下发的应答（平台网页端也是这样等的） */
function waitSipResponse(deviceId: string, timeoutMs = 30_000) {
  return new Promise<{ ok: boolean; text?: string }>((resolve) => {
    const off = realtime.on("DeviceResponse", (payload) => {
      const r = payload as DeviceResponse & { data?: { deviceId?: string; success?: boolean } };
      if (r?.command?.toLowerCase() !== "sipaccount" || !sameId(r.data?.deviceId, deviceId)) return;
      done({ ok: r.code === 0 || r.data?.success === true, text: r.message });
    });
    const timer = window.setTimeout(() => done({ ok: false, text: "30 秒内主机没有应答，主机离线时要等它上线后才会生效" }), timeoutMs);
    function done(v: { ok: boolean; text?: string }) {
      off();
      clearTimeout(timer);
      resolve(v);
    }
  });
}

function SipDialog({ m, mode, onClose, onDone }: { m: Master; mode: "enable" | "switch"; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [preview, setPreview] = useState<SipPreview>();
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text?: string }>();
  const alive = useRef(true);
  useEffect(() => {
    // 开发版 StrictMode 会先卸载再挂载一次，挂载时要重新置回
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  async function load(exclude?: string) {
    setLoading(true);
    try {
      const p = await previewMasterSip(m, mode, exclude);
      if (!alive.current) return;
      if (!p?.sipAccount) throw new Error("平台没有空闲的 SIP 账号");
      setPreview(p);
    } catch (e) {
      message.error(`取 SIP 账号失败：${errText(e)}`);
    } finally {
      if (alive.current) setLoading(false);
    }
  }

  useEffect(() => {
    // 更换时排除主机现在的账号
    load(mode === "switch" ? m.sipUserName : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function test() {
    if (!preview?.sipAccountId) return;
    setTesting(true);
    try {
      const r = await testSipAccount(m, preview.sipAccountId);
      const text = `${r?.message ?? ""}${r?.elapsedMilliseconds !== undefined ? `（${r.elapsedMilliseconds} ms）` : ""}`;
      if (r?.success) message.success(text || "账号可以注册");
      else message.warning(text || "账号测试没通过");
    } catch (e) {
      message.error(`测试失败：${errText(e)}`);
    } finally {
      setTesting(false);
    }
  }

  async function apply() {
    if (!preview?.sipAccount) return;
    setApplying(true);
    setResult(undefined);
    try {
      // 先开始等应答再下发，免得应答比接口返回还早
      const wait = waitSipResponse(m.id);
      await applyMasterSip(m, mode, preview.sipAccount);
      message.success(mode === "switch" ? "已换绑新账号，指令已下发" : "已启用并绑定账号，指令已下发");
      onDone();
      const r = await wait;
      if (alive.current) setResult(r);
    } catch (e) {
      message.error(`${mode === "switch" ? "更换" : "启用"}失败：${errText(e)}`);
    } finally {
      if (alive.current) setApplying(false);
    }
  }

  const rows = [
    { label: "服务商", value: preview?.providerName },
    { label: "SIP 服务器", value: preview?.sipServer },
    { label: "SIP 号", value: preview?.sipAccount },
    { label: "SIP 密码", value: preview?.sipPassword, secret: true },
  ];
  const finished = !!result;

  return (
    <Modal
      open
      title={`${mode === "switch" ? "更换" : "启用"} SIP 账号 · ${m.deviceName || m.sn}`}
      onCancel={onClose}
      width={520}
      footer={
        finished
          ? [
              <Button key="close" type="primary" onClick={onClose}>
                关闭
              </Button>,
            ]
          : [
              <Button key="refresh" disabled={loading || applying || testing || !preview} onClick={() => load(preview?.sipAccount)}>
                换一个
              </Button>,
              <Button key="test" loading={testing} disabled={loading || applying || !preview?.sipAccountId} onClick={test}>
                测试能否注册
              </Button>,
              <Button key="cancel" disabled={applying} onClick={onClose}>
                取消
              </Button>,
              <Button key="ok" type="primary" loading={applying} disabled={loading || testing || !preview?.sipAccount} onClick={apply}>
                确定并下发
              </Button>,
            ]
      }
    >
      {mode === "switch" && !finished && (
        <p className="muted small">主机现在的账号是 {m.sipUserName || "—"}。换成下面这个后，雷达里填了旧号码当紧急号码的，要到雷达的通话页改成新号码。</p>
      )}
      {loading && !preview ? (
        <Spin style={{ margin: 24 }} />
      ) : (
        <dl className="kv sip-kv">
          {rows.map((r) => (
            <div key={r.label} style={{ display: "contents" }}>
              <dt>{r.label}</dt>
              <dd className="mono">
                {r.secret && r.value && !showPass ? "••••••" : r.value || "—"}
                {r.secret && r.value && (
                  <Button type="text" size="small" icon={showPass ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => setShowPass((v) => !v)} />
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {applying && !result && (
        <p className="muted small" style={{ marginTop: 12 }}>
          <Spin size="small" /> 已下发，正在等主机应答…
        </p>
      )}
      {result && (
        <Alert
          style={{ marginTop: 12 }}
          type={result.ok ? "success" : "warning"}
          showIcon
          message={result.ok ? "主机已应答，SIP 账号已生效" : "主机还没有应答"}
          description={result.ok ? "稍后主机会注册到 SIP 服务器，概览里的 SIP 状态会变成已注册。" : result.text}
        />
      )}
    </Modal>
  );
}

/** 主机详情 SIP 卡片里的操作按钮 */
export default function MasterSipActions({ m, onChanged }: { m: Master; onChanged: () => void }) {
  const { modal, message } = App.useApp();
  const [dialog, setDialog] = useState<"enable" | "switch">();

  function disable() {
    modal.confirm({
      title: `停用 ${m.deviceName || m.sn} 的 SIP 账号？`,
      content: `主机将停止使用当前账号 ${m.sipUserName || ""}，平台解除绑定。之后主机不能用云对讲，紧急号码填的是这台主机的雷达也打不过来。`,
      okText: "停用并下发",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await disableMasterSip(m);
          message.success("SIP 已停用并解绑，指令已下发");
          onChanged();
        } catch (e) {
          message.error(`停用失败：${errText(e)}`);
          throw e;
        }
      },
    });
  }

  return (
    <>
      <div className="sip-actions">
        {m.sipEnable ? (
          <>
            <Button size="small" onClick={() => setDialog("switch")}>
              更换账号
            </Button>
            <Button size="small" danger onClick={disable}>
              停用 SIP
            </Button>
          </>
        ) : (
          <Button size="small" type="primary" onClick={() => setDialog("enable")}>
            启用 SIP
          </Button>
        )}
      </div>
      {dialog && <SipDialog m={m} mode={dialog} onClose={() => setDialog(undefined)} onDone={onChanged} />}
    </>
  );
}
