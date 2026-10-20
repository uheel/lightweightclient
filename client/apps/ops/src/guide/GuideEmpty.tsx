import type { ReactNode } from "react";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useGuide } from "./GuideContext";
import type { StepKey } from "./steps";
import "./guide.css";

/**
 * 页面没数据时的引导：说明这一步做什么，前置步骤没做时黄色提醒（不拦着），再给操作按钮。
 * need：前置步骤；它没完成时显示 needText，并在按钮前加一个"去完成前置步骤"。
 */
export function GuideEmpty({ icon, title, desc, need, needText, children }: { icon: ReactNode; title: string; desc: string; need?: StepKey; needText?: string; children?: ReactNode }) {
  const g = useGuide();
  const pre = need ? g?.steps.find((s) => s.key === need) : undefined;
  const missing = pre && pre.status !== "done" && pre.status !== "unknown";
  return (
    <div className="guide-empty">
      <div className="guide-empty-icon">{icon}</div>
      <b>{title}</b>
      <p>{desc}</p>
      {missing && (
        <div className="guide-empty-need">
          <ExclamationCircleOutlined /> {needText ?? `建议先完成"${pre.title}"`}
          <button onClick={() => g!.go(pre.action.target)}>{pre.action.label} →</button>
        </div>
      )}
      {children && <div className="guide-empty-actions">{children}</div>}
    </div>
  );
}
