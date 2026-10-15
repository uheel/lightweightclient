import { useEffect, useState, type ReactNode } from "react";
import { loadPrefs, session, type Session } from "../session";
import { warmUp } from "../http";
import { SERVERS } from "../auth";

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

  // 登录页一出现就预热到上次使用的服务器的连接，输入密码的这段时间把握手做完
  useEffect(() => warmUp(loadPrefs().server ?? SERVERS[0].value), []);

  useEffect(
    () =>
      session.subscribe((next, reason) => {
        setS(next);
        setNotice(reason === "expired" ? "登录已失效，请重新登录" : undefined);
      }),
    [],
  );

  return <>{s ? children(s) : login(notice)}</>;
}
