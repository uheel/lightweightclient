import { LoginPage, SessionGate } from "@radar/core";
import Shell from "./Shell";

export default function RootApp() {
  return (
    <SessionGate
      login={(notice) => (
        <LoginPage
          appName="康养看护"
          tagline="长者此刻的状态、需要关注的事、昨夜睡得好不好，一眼看清。"
          logo={<img src="/logo.svg" alt="" width={48} height={48} />}
          notice={notice}
        />
      )}
    >
      {(s) => <Shell s={s} />}
    </SessionGate>
  );
}
