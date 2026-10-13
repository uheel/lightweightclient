import { useEffect, useState } from "react";
import { realtime, startRealtime, stopRealtime, type RealtimeEvent, type RealtimeState } from "../realtime";

/** 登录后连接实时通道，切换机构时重连；返回连接状态并把推送交给 onEvent */
export function useRealtime(orgId: string, onEvent?: (e: RealtimeEvent) => void) {
  const [state, setState] = useState<RealtimeState>(realtime.state);

  useEffect(() => {
    startRealtime();
    return () => void stopRealtime();
  }, [orgId]);

  useEffect(() => realtime.onState((st) => setState(st)), []);

  useEffect(() => (onEvent ? realtime.onEvent(onEvent) : undefined), [onEvent]);

  return state;
}
