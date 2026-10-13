import { useEffect, useState } from "react";
import { App, TreeSelect } from "antd";
import { findOrg, getOrgTree, switchOrg, type OrgNode } from "../org";
import type { Session } from "../session";

function count(nodes: OrgNode[]): number {
  return nodes.reduce((n, x) => n + 1 + count(x.children ?? []), 0);
}

/**
 * 机构选择。账号只能看到一个机构时不显示下拉，只显示机构名（fallback）。
 * 切换后所有请求的 orgid / orgtype 随之改变，页面按 orgId 重新加载。
 */
export function OrgPicker({ s, className, fallback }: { s: Session; className?: string; fallback?: React.ReactNode }) {
  const { message } = App.useApp();
  const [tree, setTree] = useState<OrgNode[]>([]);

  useEffect(() => {
    getOrgTree().then(setTree, () => setTree([]));
    // 只在登录后加载一次；切换机构不影响可选范围
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.rawOrgId]);

  if (count(tree) <= 1) return <>{fallback ?? null}</>;

  return (
    <TreeSelect
      className={className}
      value={s.orgId}
      treeData={tree}
      showSearch
      treeNodeFilterProp="title"
      treeDefaultExpandedKeys={[s.orgId]}
      popupMatchSelectWidth={360}
      variant="filled"
      treeLine
      onChange={async (v: string) => {
        const node = findOrg(tree, v);
        if (!node) return;
        await switchOrg(node);
        message.success(`已切换到 ${node.title}`);
      }}
    />
  );
}
