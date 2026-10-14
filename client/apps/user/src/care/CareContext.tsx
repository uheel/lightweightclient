import { createContext, useContext } from "react";
import type { Session } from "@radar/core";
import type { CareAlert } from "./api";
import type { useCareData } from "./useCareData";

/**
 * 用户端各模块共享的数据（在 Shell 里提供）：
 * 长者列表 + 实时状态（只订阅一次）、待处理告警、打开长者详情、处理告警。
 */
export type CareCtx = ReturnType<typeof useCareData> & {
  s: Session;
  alerts: { list: CareAlert[]; total: number };
  /** 打开某位长者的详情 */
  openElder: (memberId: string) => void;
  /** 打开处理告警弹窗 */
  process: (a: CareAlert) => void;
  /** 告警处理后刷新 */
  reloadAlerts: () => void;
};

const Ctx = createContext<CareCtx | null>(null);
export const CareProvider = Ctx.Provider;

export function useCare() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCare 必须在 CareProvider 内使用");
  return c;
}
