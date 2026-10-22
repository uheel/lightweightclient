import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Table, Tag } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { CALL_STATUS, getCallRecords, type CallRecord } from "../../api/master";

/** 通话一方：设备名（房间 · 区域），手机等没有设备的写号码 */
function party(name?: string, room?: string, range?: string, id?: string) {
  const where = [room, range && range !== name ? range : undefined].filter(Boolean).join(" · ");
  return (name || id || "—") + (where ? `（${where}）` : "");
}

/**
 * 一台设备的通话记录：平台只能取整个机构的，按主叫 / 被叫的 SN 或 SIP 号在本地筛。
 * 方向按主叫是不是这台设备判断，不用平台的 callType（主机呼雷达也记成"雷达 → 主机"）
 */
export default function CallRecords({ sn, sip, orgId }: { sn: string; sip?: string; orgId: string }) {
  const { message } = App.useApp();
  const [all, setAll] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAll(await getCallRecords({ orgId }));
    } catch (e) {
      message.error(`读取通话记录失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [message, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const ids = new Set([sn, sip].filter(Boolean));
    return all.filter((r) => [r.callerSn, r.calleeSn, r.calleeIdentifier, r.calleeNumber].some((v) => v && ids.has(v)));
  }, [all, sn, sip]);

  return (
    <div className="detail-body">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="muted small">机构最近 {all.length} 条通话里和这台设备有关的 {rows.length} 条</span>
        <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} title="刷新" />
      </div>
      <Table<CallRecord>
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{ emptyText: "没有通话记录" }}
        columns={[
          { title: "时间", dataIndex: "startAt", width: 116, render: (v) => (v ? dayjs(v).format("MM-DD HH:mm:ss") : "—") },
          {
            title: "通话",
            key: "who",
            render: (_, r) => {
              const out = r.callerSn === sn;
              return (
                <span>
                  <Tag color={out ? "blue" : "purple"}>{out ? "呼出" : "呼入"}</Tag>
                  {out
                    ? party(r.calleeDeviceName, r.calleeRoomName, r.calleeRangeName, r.calleeIdentifier)
                    : party(r.callerDeviceName, r.callerRoomName, r.callerRangeName, r.callerIdentifier)}
                </span>
              );
            },
          },
          { title: "结果", dataIndex: "status", width: 86, render: (v) => (CALL_STATUS[v] ? <Tag color={CALL_STATUS[v].color}>{CALL_STATUS[v].text}</Tag> : "—") },
          { title: "时长", dataIndex: "elapsedSeconds", width: 64, render: (v) => (v ? `${v} 秒` : "—") },
        ]}
      />
    </div>
  );
}
