import { Button, InputNumber, Switch, Tag } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DashboardOutlined } from "@ant-design/icons";
import { ModuleName } from "../workspace/ModuleName";
import { defaultConfig, MAX_SECONDS, MIN_SECONDS, setWallConfig, useWallConfig, type WallPageConfig } from "../datawall/config";
import { WALL_PAGES } from "../datawall/pages";
import "../datawall/wall.css";

/** 魔墙设置：轮播开关，各页面显示隐藏、顺序、停留时间。全房间看板的范围、排版在魔墙工具栏的"显示设置"里（要用当前机构的楼层） */
export default function WallSettingsPage({ onOpen }: { onOpen: (k: "dataWall") => void }) {
  const c = useWallConfig();
  const shown = c.pages.filter((p) => p.enabled).length;
  const roomsOff = c.pages.some((p) => p.key === "rooms" && !p.enabled);

  const patch = (key: string, v: Partial<WallPageConfig>) => setWallConfig({ ...c, pages: c.pages.map((p) => (p.key === key ? { ...p, ...v } : p)) });
  const move = (i: number, d: number) => {
    const pages = [...c.pages];
    [pages[i], pages[i + d]] = [pages[i + d], pages[i]];
    setWallConfig({ ...c, pages });
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          <ModuleName k="wallSettings" />
        </h1>
        <Button size="small" icon={<DashboardOutlined />} onClick={() => onOpen("dataWall")} style={{ marginLeft: "auto" }}>
          <ModuleName k="dataWall" />
        </Button>
      </div>

      <div className="ops-card">
        <h2>
          轮播
          <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
            打开后各页面按下面的顺序和时间自动切换。只存在这台电脑上，所有机构共用
          </span>
        </h2>
        <div className="wall-cfg-row">
          <Switch checked={c.carousel} onChange={(carousel) => setWallConfig({ ...c, carousel })} />
          <span>{c.carousel ? "自动轮播" : "不轮播，在魔墙工具栏手动切换"}</span>
        </div>
      </div>

      <div className="ops-card">
        <h2 className="wall-cfg-head">
          页面
          <Button size="small" type="link" onClick={() => setWallConfig({ ...defaultConfig(), carousel: c.carousel })}>
            恢复默认
          </Button>
        </h2>
        <div className="wall-cfg-list">
          {c.pages.map((p, i) => {
            const def = WALL_PAGES.find((d) => d.key === p.key)!;
            return (
              <div key={p.key} className={`wall-cfg-item${p.enabled ? "" : " off"}`}>
                <span className="wall-cfg-move">
                  <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`上移${def.title}`} />
                  <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={i === c.pages.length - 1} onClick={() => move(i, 1)} aria-label={`下移${def.title}`} />
                </span>
                <span className="wall-cfg-name">{def.title}</span>
                <Tag color={def.kind === "rooms" ? "blue" : "default"}>{def.kind === "rooms" ? "客户端" : "平台原页面"}</Tag>
                <span className="wall-cfg-time">
                  {def.kind === "rooms" ? "每屏" : "停留"}
                  <InputNumber
                    size="small"
                    min={MIN_SECONDS}
                    max={MAX_SECONDS}
                    precision={0}
                    value={p.seconds}
                    disabled={!p.enabled}
                    onChange={(seconds) => seconds && patch(p.key, { seconds })}
                  />
                  秒
                </span>
                {/* 至少留一页 */}
                <Switch size="small" checked={p.enabled} disabled={p.enabled && shown === 1} onChange={(enabled) => patch(p.key, { enabled })} aria-label={`显示${def.title}`} />
              </div>
            );
          })}
        </div>
        <p className="muted wall-cfg-note">隐藏的平台原页面不加载、不占内存。全房间看板放不下时会先翻完自己的几屏，再轮到下一页；没加载好的平台页面轮播时跳过。</p>
        {roomsOff && <p className="wall-cfg-warn">全房间看板隐藏后，魔墙上不再显示告警，来紧急告警也不会自动切过去。</p>}
      </div>

      <p className="muted wall-cfg-note">全房间看板的显示范围、行列排版和放不下时的方式，在魔墙工具栏的"显示设置"里，按机构分别保存。</p>
    </div>
  );
}
