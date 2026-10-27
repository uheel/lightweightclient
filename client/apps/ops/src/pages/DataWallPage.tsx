import { Empty } from "antd";
import { ModuleName } from "../workspace/ModuleName";

/** 数据魔墙：先占位，功能后面再做 */
export default function DataWallPage() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>
          <ModuleName k="dataWall" />
        </h1>
      </div>
      <div className="ops-card">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="功能开发中，暂未开放" style={{ padding: "48px 0" }} />
      </div>
    </div>
  );
}
