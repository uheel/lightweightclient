import { useState } from "react";
import { Button, Empty, Tag, Tooltip } from "antd";
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, SyncOutlined } from "@ant-design/icons";
import { roomSize } from "../api/room";
import { RECORD_TEXT, type Level, type RadarReport, type RoomReport } from "./check";
import type { Issue } from "./qinglan";
import { describeDiff, facingText, MODE, modeOf, MOUNT, mountOf, parseArray, sameArray, ZONE_COLOR, ZONE_TYPE, zonesOf } from "./qinglan";
import RoomPlan from "./RoomPlan";
import AreaSelect from "./AreaSelect";
import { areaText, type InstallArea } from "./installArea";

/** 从设备读回的区域数组；6 型应答里是报文别名 */
export interface DeviceRead {
  loading?: boolean;
  at?: number;
  config?: unknown;
  area?: unknown;
  error?: string;
}

export const LEVEL_TEXT: Record<Level, string> = { ok: "正常", warn: "需注意", error: "有问题", none: "无雷达" };
const LEVEL_CLASS: Record<Level, string> = { ok: "ok", warn: "warn", error: "bad", none: "" };

/** 一条问题；有逐项说明时列在下面 */
export function IssueItem({ i, who, onHover, onFix, fixing }: { i: Issue; who?: string; onHover?: (zone?: number) => void; onFix?: (i: Issue) => void; fixing?: boolean }) {
  return (
    <li className={`issue ${i.level}`} onMouseEnter={() => onHover?.(i.zone)} onMouseLeave={() => onHover?.()}>
      <span className="issue-line">
        {i.level === "error" ? <CloseCircleFilled /> : <ExclamationCircleFilled />}
        {who && <b className="issue-dev">{who}</b>}
        <span>{i.text}</span>
        {i.fix && onFix && (
          <Button
            size="small"
            type="link"
            loading={fixing}
            onClick={() => onFix(i)}
            title={i.fix === "renumber" ? "把布置里的区域编号改成和设备一致，只保存布置，设备上不变" : "按空位置 → 户型里的雷达 → 空白默认放一个雷达进布置"}
          >
            {i.fix === "renumber" ? "重排编号" : "放进布置"}
          </Button>
        )}
      </span>
      {i.details && i.details.length > 0 && (
        <ul className="issue-details">
          {i.details.map((d, k) => (
            <li key={k}>{d}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

const fmtArr = (v: unknown) => {
  const a = parseArray(v);
  if (!a) return v === undefined ? "—" : String(v);
  return JSON.stringify(a);
};

export default function RoomDetail({
  report,
  typeName,
  reads,
  onRead,
  onFix,
  fixing,
  onArea,
}: {
  report: RoomReport;
  typeName: (t?: number) => string;
  reads: Record<string, DeviceRead>;
  onRead: (r: RadarReport) => void;
  /** 一键修复（重排编号、放进布置），保存布置 */
  onFix?: (i: Issue, r: RadarReport) => void;
  fixing?: boolean;
  /** 改这台雷达的安装区域（保存布置） */
  onArea?: (r: RadarReport, a: InstallArea | null) => Promise<void>;
}) {
  const { room, design, radars } = report;
  const [focus, setFocus] = useState<{ sn?: string; zone?: number }>({});
  const size = roomSize(design, room);
  const place = [room.buildingName, room.floorName].filter(Boolean).join(" / ");
  const label = (r: RadarReport) => r.device?.deviceName || r.element?.deviceName || r.sn || "未绑设备";
  // 房间里不止一台雷达时，平面图上写上装在哪（卫生间 · 1201 卫）
  const planLabel = (r: RadarReport) => (radars.length > 1 && r.area ? `${areaText(r.area)} · ${label(r)}` : label(r));

  return (
    <div className="detail room-detail">
      <div className="detail-head">
        <div className="detail-title">
          <h1>{room.roomName}</h1>
          {report.level !== "none" && <span className={`grade ${LEVEL_CLASS[report.level]}`}>{LEVEL_TEXT[report.level]}</span>}
        </div>
        <div className="detail-sub room-sub">
          <span>{place || "—"}</span>
          <span>
            {(size.width / 100).toFixed(1)} × {(size.height / 100).toFixed(1)} m
          </span>
          <span>{radars.length ? `${radars.length} 台雷达` : "没有雷达"}</span>
        </div>
      </div>

      {report.issues.length > 0 && (
        <ul className="issues">
          {report.issues.map((i, k) => (
            <IssueItem key={k} i={i} />
          ))}
        </ul>
      )}

      <div className="ops-card room-plan-card" onMouseLeave={() => setFocus({})}>
        <RoomPlan
          design={design}
          size={size}
          radars={radars.map((r) => ({ sn: r.sn, label: planLabel(r), config: r.config, element: r.element }))}
          focusSn={focus.sn}
          focusZone={focus.zone}
        />
        <div className="plan-legend small muted">
          <span>
            <i className="lg bound" /> 监测边界
          </span>
          <span>
            <i className="lg container" /> 最大探测范围
          </span>
          <span>
            <i className="lg supervision" /> 监护区（监护床必须在里面）
          </span>
          {[5, 2, 4, 6, 3, 7].map((t) => (
            <span key={t}>
              <i className="lg" style={{ background: ZONE_COLOR[t] }} /> {ZONE_TYPE[t]}
            </span>
          ))}
          <span>数字是设备上的区域 ID，场景里的 {"{{area}}"} 填它</span>
        </div>
      </div>

      {radars.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个房间没有雷达" />}
      {radars.map((r) => (
        <RadarCard
          key={r.sn || r.element?.id}
          r={r}
          label={label(r)}
          typeName={typeName}
          read={reads[r.sn]}
          onRead={() => onRead(r)}
          onFocus={(zone) => setFocus({ sn: r.sn, zone })}
          onFix={onFix ? (i) => onFix(i, r) : undefined}
          fixing={fixing}
          onArea={onArea && r.element && r.sn ? (a) => onArea(r, a) : undefined}
        />
      ))}
    </div>
  );
}

function RadarCard({
  r,
  label,
  typeName,
  read,
  onRead,
  onFocus,
  onFix,
  fixing,
  onArea,
}: {
  r: RadarReport;
  label: string;
  typeName: (t?: number) => string;
  read?: DeviceRead;
  onRead: () => void;
  onFocus: (zone?: number) => void;
  onFix?: (i: Issue) => void;
  fixing?: boolean;
  onArea?: (a: InstallArea | null) => Promise<void>;
}) {
  const [savingArea, setSavingArea] = useState(false);
  const c = r.config;
  const d = r.device;
  const type = d?.deviceType ?? r.element?.deviceType;
  const zones = c ? zonesOf(c) : [];
  const keeps = r.expected;
  const devConfig = read?.config;
  const devArea = read?.area;
  const devMatch = read?.at && keeps ? sameArray(devConfig, keeps.config) && sameArray(devArea ?? [], keeps.area) : undefined;

  return (
    <div className="ops-card radar-card" onMouseEnter={() => onFocus()}>
      <h2>
        <i className={`dot ${d ? (d.isDisabled ? "disabled" : d.isOnline ? "online" : "offline") : "offline"}`} />
        <span>{label}</span>
        <small className="mono muted">{r.sn}</small>
        {type !== undefined && (
          <Tag bordered={false} className="small">
            {typeName(type)}
          </Tag>
        )}
        {onArea ? (
          <AreaSelect
            size="small"
            value={r.area}
            loading={savingArea}
            disabled={savingArea}
            placeholder="安装区域"
            onChange={(a) => {
              setSavingArea(true);
              onArea(a).finally(() => setSavingArea(false));
            }}
          />
        ) : (
          r.area && (
            <Tag bordered={false} className="small">
              {areaText(r.area)}
            </Tag>
          )
        )}
        <span className="grow" />
        {r.level !== "none" && <span className={`grade ${LEVEL_CLASS[r.level]}`}>{LEVEL_TEXT[r.level]}</span>}
        {r.level === "none" && <span className="muted small">{r.placeholder ? "空位置，装设备时沿用这里的安装方式和区域" : "这个型号不配区域"}</span>}
      </h2>

      {c && (
        <dl className="kv radar-kv">
          <dt>装法</dt>
          <dd>
            {MOUNT[mountOf(c)]} · {facingText(c)} · {c.installHeight ?? "?"} m
          </dd>
          <dt>模式</dt>
          <dd>{MODE[modeOf(c)] ?? `模式 ${c.workingType}`}</dd>
          <dt>区域</dt>
          <dd className="zone-chips">
            {zones.length ? (
              zones.map((z) => (
                <span key={z.id ?? z.index} className="zone-chip" onMouseEnter={() => onFocus(z.index)} onMouseLeave={() => onFocus()}>
                  <i style={{ background: ZONE_COLOR[z.type] ?? "#999" }} />
                  <b>{z.index}</b> {z.text || ZONE_TYPE[z.type] || `类型 ${z.type}`}
                  <small>
                    {Math.round(z.width)}×{Math.round(z.height)}
                  </small>
                </span>
              ))
            ) : (
              <span className="muted">没有区域</span>
            )}
          </dd>
        </dl>
      )}

      {r.issues.length > 0 && (
        <ul className="issues">
          {r.issues.map((i, k) => (
            <IssueItem key={k} i={i} onHover={onFocus} onFix={onFix} fixing={fixing} />
          ))}
        </ul>
      )}

      {r.expected && (
        <div className="sync">
          <div className="sync-head">
            <b>下发给设备的数据</b>
            {r.record && (
              <Tag bordered={false} color={r.record.state === "match" ? "default" : r.record.state === "failed" ? "error" : "warning"}>
                {RECORD_TEXT[r.record.state]}
                {r.record.config?.deliveryAt ? ` · 上次下发 ${r.record.config.deliveryAt}` : ""}
              </Tag>
            )}
            {devMatch !== undefined &&
              (devMatch ? (
                <Tag bordered={false} color="success" icon={<CheckCircleFilled />}>
                  设备上一致
                </Tag>
              ) : (
                <Tag bordered={false} color="error" icon={<CloseCircleFilled />}>
                  设备上不一致
                </Tag>
              ))}
            <span className="grow" />
            <Tooltip title={!d?.isOnline ? "设备离线" : "从设备读出当前的安装配置和区域，和布置比对（平台也会把读到的值存成记录）"}>
              <Button size="small" icon={<SyncOutlined spin={read?.loading} />} disabled={!d?.isOnline || read?.loading} onClick={onRead}>
                读设备核对
              </Button>
            </Tooltip>
          </div>
          <table className="sync-table">
            <thead>
              <tr>
                <th />
                <th>安装配置 QL_radar_config</th>
                <th>区域 QL_radar_area</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>按布置应为</td>
                <td className="mono">{fmtArr(r.expected.config)}</td>
                <td className="mono">{fmtArr(r.expected.area)}</td>
              </tr>
              <tr>
                <td>平台记录</td>
                <td className={`mono${r.record?.config && !sameArray(r.record.config.value, r.expected.config) ? " diff" : ""}`}>{fmtArr(r.record?.config?.value)}</td>
                <td className={`mono${r.record?.area && !sameArray(r.record.area.value, r.expected.area) ? " diff" : ""}`}>{fmtArr(r.record?.area?.value)}</td>
              </tr>
              {(read?.at || read?.error) && (
                <tr>
                  <td>设备上</td>
                  {read.error ? (
                    <td colSpan={2} className="err-text">
                      {read.error}
                    </td>
                  ) : (
                    <>
                      <td className={`mono${keeps && !sameArray(devConfig, keeps.config) ? " diff" : ""}`}>{fmtArr(devConfig)}</td>
                      <td className={`mono${keeps && !sameArray(devArea ?? [], keeps.area) ? " diff" : ""}`}>{fmtArr(devArea)}</td>
                    </>
                  )}
                </tr>
              )}
            </tbody>
          </table>
          {devMatch === false && r.expected && (
            <ul className="issue-details">
              {describeDiff(r.expected, devConfig, devArea).map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
