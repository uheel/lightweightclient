import { useEffect, useMemo, useState } from "react";
import { AutoComplete, Empty, Input } from "antd";
import { getRadars, type Radar } from "../api/device";
import LogTable from "../devices/LogTable";

/**
 * 通信日志：一次查一台设备。
 * 不支持"全部设备"：不带 SN 时平台要扫当天全部设备的日志，设备多的机构会一直不返回。
 */
export default function LogsPage({ initialSn }: { initialSn?: string }) {
  const [radars, setRadars] = useState<Radar[]>([]);
  const [input, setInput] = useState(initialSn ?? "");
  const [sn, setSn] = useState(initialSn?.trim() || undefined);

  useEffect(() => {
    getRadars().then(setRadars, () => {});
  }, []);

  const options = useMemo(() => {
    const kw = input.trim().toLowerCase();
    return radars
      .filter((d) => !kw || [d.sn, d.deviceName, d.roomName].some((v) => v?.toLowerCase().includes(kw)))
      .slice(0, 50)
      .map((d) => ({
        value: d.sn,
        label: (
          <span className="sn-option">
            <i className={`dot ${d.isOnline ? "online" : "offline"}`} />
            <b>{d.deviceName || d.sn}</b>
            <span className="mono muted">{d.sn}</span>
            <span className="muted">{d.roomName}</span>
          </span>
        ),
      }));
  }, [radars, input]);

  const current = radars.find((d) => d.sn === sn);
  const go = (v: string) => setSn(v.trim() || undefined);

  return (
    <div className="page">
      <div className="page-head">
        <h1>通信日志</h1>
        <AutoComplete options={options} value={input} onChange={setInput} onSelect={(v: string) => go(v)} style={{ width: 420 }} popupMatchSelectWidth={520}>
          <Input.Search allowClear placeholder="选择设备，或输入 SN / 名称 / 房间" enterButton="查询" onSearch={go} />
        </AutoComplete>
        {current && (
          <span className="muted">
            {current.deviceName} · {current.roomName || "未绑定房间"}
          </span>
        )}
      </div>
      <div className="ops-card">
        {sn ? (
          <LogTable key={sn} sn={sn} />
        ) : (
          <Empty description="先在上方选择一台设备。也可以在设备详情里点「在日志中查询」。" />
        )}
      </div>
    </div>
  );
}
