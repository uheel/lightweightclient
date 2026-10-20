import { LoginPage, SessionGate } from "@radar/core";
import Shell from "./Shell";

export default function RootApp() {
  return (
    <SessionGate
      login={(notice) => (
        <LoginPage
          appName="Radar Config"
          tagline="设备状态、安装角度、通信日志，运维排障一个窗口搞定。"
          logo={<img src="/logo.svg" alt="" width={48} height={48} />}
          notice={notice}
        />
      )}
    >
      {(s) => <Shell s={s} />}
    </SessionGate>
  );
}
