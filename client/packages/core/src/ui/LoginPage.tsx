import { useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Form, Input, Popover } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { isTauri } from "../http";
import { loadPrefs, savePrefs, session } from "../session";
import { CAN_PICK_SERVER, initialServer, SERVERS, signIn } from "../auth";
import { brand } from "../theme";
import { BreathTrace, type BreathTraceHandle } from "./BreathTrace";
import { revealFromLine } from "./SessionGate";
import { WindowControls } from "./WindowControls";
import "./LoginPage.css";

export interface LoginPageProps {
  /** 客户端名称，例如"雷达运维" / "康养看护" */
  appName: string;
  /** 名称下方的一句话介绍 */
  tagline: string;
  logo: ReactNode;
  /** 表单上方的提示，例如"登录已失效" */
  notice?: string;
}

interface FormValues {
  username: string;
  password: string;
  remember: boolean;
}

const host = (url: string) => url.replace(/^https?:\/\//, "");
/** "正式环境 rd.igoodlife.com" → "正式环境" */
const serverName = (url: string) => SERVERS.find((s) => s.value === url)?.label.split(" ")[0] ?? host(url);

/** 服务器很少切换，收进右上角 */
function ServerSwitch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(SERVERS.some((s) => s.value === value) ? "" : value);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const content = (
    <div className="lp-pop" role="radiogroup" aria-label="服务器">
      {SERVERS.map((s) => (
        <button
          key={s.value}
          type="button"
          role="radio"
          aria-checked={s.value === value}
          className="lp-pop-opt"
          onClick={() => pick(s.value)}
        >
          {s.label.split(" ")[0]}
          <span>{host(s.value)}</span>
        </button>
      ))}
      <div className="lp-pop-custom">
        <label htmlFor="lp-server-custom">其他服务器地址</label>
        <Input.Search
          id="lp-server-custom"
          placeholder="https://"
          enterButton="使用"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onSearch={(v) => {
            const url = v.trim().replace(/\/+$/, "");
            if (url) pick(/^https?:\/\//.test(url) ? url : `https://${url}`);
          }}
        />
      </div>
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomRight" open={open} onOpenChange={setOpen} arrow={false}>
      <button type="button" className="lp-server" aria-haspopup="dialog">
        服务器 <b>{serverName(value)}</b>
        <DownOutlined style={{ fontSize: 10 }} />
      </button>
    </Popover>
  );
}

/** 两个客户端共用的登录页：一条呼吸波形横贯窗口，名称在线上，表单在线下 */
export function LoginPage({ appName, tagline, logo, notice }: LoginPageProps) {
  const prefs = loadPrefs();
  const [server, setServer] = useState(initialServer);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  const trace = useRef<BreathTraceHandle>(null);

  async function onFinish(v: FormValues) {
    setLoading(true);
    setError(undefined);
    let s;
    try {
      s = await signIn(server, v.username.trim(), v.password);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
      trace.current?.shake();
      return;
    }
    savePrefs({ server, username: v.remember ? v.username.trim() : "" });
    // 线先深吸一口气、拉直，再从这条线拉开进入主界面
    setLeaving(true);
    const y = (await trace.current?.settle()) ?? 0;
    revealFromLine(y);
    session.set(s);
  }

  return (
    <div className={leaving ? "lp lp-leaving" : "lp"}>
      {/* 关掉系统标题栏时，顶部这条用来拖动窗口 */}
      <div className="lp-bar" data-tauri-drag-region>
        <WindowControls />
      </div>
      <div className="lp-top" data-tauri-drag-region>
        {logo}
        {CAN_PICK_SERVER && <ServerSwitch value={server} onChange={setServer} />}
      </div>

      <div className="lp-head">
        <h1 className="lp-name">{appName}</h1>
        <p className="lp-tagline">{tagline}</p>
      </div>

      <div className="lp-trace">
        <BreathTrace ref={trace} color={brand.primary} />
      </div>

      <Form<FormValues>
        className="lp-form"
        requiredMark={false}
        initialValues={{ username: prefs.username, remember: true }}
        onFinish={onFinish}
        onFinishFailed={() => trace.current?.shake(0.45)}
      >
        {notice && <p className="lp-notice" role="status">{notice}</p>}
        <div className="lp-row">
          <div className="lp-field" style={{ position: "relative" }}>
            <label htmlFor="lp-username">用户名</label>
            <Form.Item name="username" rules={[{ required: true, message: "请输入用户名" }]}>
              <Input id="lp-username" autoComplete="username" autoFocus={!prefs.username} />
            </Form.Item>
          </div>
          <div className="lp-field" style={{ position: "relative" }}>
            <label htmlFor="lp-password">密码</label>
            <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password id="lp-password" autoComplete="current-password" autoFocus={!!prefs.username} />
            </Form.Item>
          </div>
          <Button className="lp-submit" type="primary" htmlType="submit" loading={loading}>
            登录
          </Button>
        </div>
        <div className="lp-under">
          <Form.Item name="remember" valuePropName="checked">
            <Checkbox>记住服务器和用户名，密码不保存</Checkbox>
          </Form.Item>
          {error && (
            <p className="lp-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Form>

      <div className="lp-foot">
        <p>登录用平台账号，与网页端相同。登录状态只保存在本机内存里，关闭客户端即退出。</p>
        {!isTauri && <p>浏览器调试模式：请求经 vite 代理转发到 rd.igoodlife.com，服务器选择不生效。</p>}
      </div>
    </div>
  );
}
