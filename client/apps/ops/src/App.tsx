import { useEffect } from "react";
import { LoginPage, SessionGate } from "@radar/core";
import Shell from "./Shell";
import { applyWindowTitle, BrandLogo, useBrand } from "./workspace/brand";

export default function RootApp() {
  const { name } = useBrand();

  useEffect(() => {
    applyWindowTitle(name).catch(() => {});
  }, [name]);

  return (
    <SessionGate
      login={(notice) => (
        <LoginPage
          appName={name}
          tagline="设备状态、安装角度、通信日志，运维排障一个窗口搞定。"
          logo={<BrandLogo size={48} />}
          notice={notice}
        />
      )}
    >
      {(s) => <Shell s={s} />}
    </SessionGate>
  );
}
