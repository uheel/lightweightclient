import { useState, type ReactNode } from "react";
import { Alert, AutoComplete, Button, Checkbox, Form, Input, Typography } from "antd";
import { CloudServerOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";
import { isTauri } from "../http";
import { loadPrefs, savePrefs, session } from "../session";
import { SERVERS, signIn } from "../auth";
import { brand } from "../theme";

export interface LoginPageProps {
  /** 客户端名称，例如"雷达运维" / "康养看护" */
  appName: string;
  /** 左侧品牌区的一句话介绍 */
  tagline: string;
  logo: ReactNode;
  /** 顶部提示，例如"登录已失效" */
  notice?: string;
}

interface FormValues {
  server: string;
  username: string;
  password: string;
  remember: boolean;
}

/** 两个客户端共用的登录页：左侧品牌区，右侧表单（对应界面稿"登录"画板） */
export function LoginPage({ appName, tagline, logo, notice }: LoginPageProps) {
  const prefs = loadPrefs();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function onFinish(v: FormValues) {
    setLoading(true);
    setError(undefined);
    try {
      const server = v.server.trim().replace(/\/+$/, "");
      const s = await signIn(server, v.username.trim(), v.password);
      savePrefs({ server, username: v.remember ? v.username.trim() : "" });
      session.set(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexWrap: "wrap", background: "#fff" }}>
      <div
        style={{
          flex: "1 1 420px",
          position: "relative",
          overflow: "hidden",
          background: brand.navy,
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "40px 48px",
          minHeight: 320,
        }}
      >
        {[640, 440, 240].map((d, i) => (
          <div
            key={d}
            style={{
              position: "absolute",
              right: [-180, -80, 20][i],
              top: "50%",
              width: d,
              height: d,
              marginTop: -d / 2,
              borderRadius: "50%",
              border: `1px solid ${["#262C66", "#2D347A", "#3A4290"][i]}`,
            }}
          />
        ))}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16, maxWidth: 420 }}>
          {logo}
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.25 }}>{appName}</div>
          <div style={{ color: "#AEB3D6", fontSize: 15 }}>{tagline}</div>
        </div>
      </div>

      <div style={{ flex: "1 1 420px", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 360 }}>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            登录
          </Typography.Title>
          <Typography.Paragraph type="secondary">使用平台账号，与网页端相同</Typography.Paragraph>

          {notice && <Alert type="warning" showIcon message={notice} style={{ marginBottom: 16 }} />}
          {!isTauri && (
            <Alert
              type="info"
              showIcon
              message="浏览器调试模式：请求经 vite 代理转发到 rd.igoodlife.com，服务器选项不生效"
              style={{ marginBottom: 16 }}
            />
          )}

          <Form<FormValues>
            layout="vertical"
            size="large"
            requiredMark={false}
            initialValues={{ server: prefs.server ?? SERVERS[0].value, username: prefs.username, remember: true }}
            onFinish={onFinish}
          >
            <Form.Item name="server" label="服务器" rules={[{ required: true, message: "请选择或输入服务器地址" }]}>
              <AutoComplete options={SERVERS}>
                <Input prefix={<CloudServerOutlined />} placeholder="https://rd.igoodlife.com" />
              </AutoComplete>
            </Form.Item>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
              <Input prefix={<UserOutlined />} autoComplete="username" autoFocus={!prefs.username} />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password prefix={<LockOutlined />} autoComplete="current-password" autoFocus={!!prefs.username} />
            </Form.Item>
            <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 16 }}>
              <Checkbox>记住服务器和用户名（密码不保存）</Checkbox>
            </Form.Item>
            {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form>
          <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            登录态只保存在本机内存中，关闭客户端即退出。
          </Typography.Paragraph>
        </div>
      </div>
    </div>
  );
}
