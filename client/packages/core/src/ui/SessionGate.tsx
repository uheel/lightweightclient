import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { session, type Session } from "../session";
import { warmUp } from "../http";
import { initialServer } from "../auth";
import { brand } from "../theme";

/** 登录页收好线后记下线的位置（视口 y），下次登录成功时从这条线拉开 */
let pendingReveal: number | null = null;
export function revealFromLine(y: number) {
  pendingReveal = y;
}

/**
 * 登录成功后的开幕：登录页沿呼吸线裂成上下两片，各带半条线向两侧滑走，露出底下已经挂载的主界面。
 * 只动 transform，主界面首次渲染卡一下也不影响动画。样式在 LoginPage.css。
 */
function Curtain({ y, onDone }: { y: number; onDone: () => void }) {
  return (
    <div className="sg-curtain" style={{ "--y": `${y}px`, "--c": brand.primary } as CSSProperties} aria-hidden="true">
      <div className="sg-curtain-top" />
      <div className="sg-curtain-bottom" onAnimationEnd={onDone} />
    </div>
  );
}

/**
 * 未登录时渲染 login(notice)，登录后渲染 children(session)。
 * 会话过期（任意请求返回 401）会自动回到登录页并提示。
 */
export function SessionGate({
  login,
  children,
}: {
  login: (notice?: string) => ReactNode;
  children: (s: Session) => ReactNode;
}) {
  const [s, setS] = useState<Session | null>(session.get());
  const [notice, setNotice] = useState<string>();
  const [reveal, setReveal] = useState<number | null>(null);

  // 登录页一出现就预热到上次使用的服务器的连接，输入密码的这段时间把握手做完
  useEffect(() => warmUp(initialServer()), []);

  useEffect(
    () =>
      session.subscribe((next, reason) => {
        if (next && pendingReveal !== null) setReveal(pendingReveal);
        pendingReveal = null;
        setS(next);
        setNotice(reason === "expired" ? "登录已失效，请重新登录" : undefined);
      }),
    [],
  );

  if (!s) return <>{login(notice)}</>;
  return (
    <>
      {children(s)}
      {reveal !== null && <Curtain y={reveal} onDone={() => setReveal(null)} />}
    </>
  );
}
