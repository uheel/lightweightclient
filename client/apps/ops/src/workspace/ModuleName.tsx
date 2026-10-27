import type { ModuleKey } from "./modules";
import { useNames } from "./names";

/** 模块现在的名字（系统设置里可以改），页面左上角的标题用它，和工作台、标签上的一致 */
export function ModuleName({ k }: { k: ModuleKey }) {
  return <>{useNames().module(k)}</>;
}
