import { Alert, Button, Card, Empty, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { realtime, startRealtime, type RealtimeEvent, type RealtimeState } from "@radar/core";

export const STATE_TEXT: Record<RealtimeState, { text: string; color: string }> = {
  connected: { text: "已连接", color: "success" },
  connecting: { text: "连接中", color: "processing" },
  reconnecting: { text: "重连中", color: "warning" },
  disconnected: { text: "未连接", color: "default" },
};

export default function RealtimePage({
  state,
  events,
  onClear,
}: {
  state: RealtimeState;
  events: RealtimeEvent[];
  onClear: () => void;
}) {
  return (
    <div className="page">
      <Card size="small">
        <div className="realtime-head">
          <span>
            SignalR <Typography.Text code>/hub/message</Typography.Text>
            <Tag color={STATE_TEXT[state].color} style={{ marginLeft: 8 }}>
              {STATE_TEXT[state].text}
            </Tag>
          </span>
          <span>
            <Button size="small" onClick={() => startRealtime()} disabled={state === "connecting"}>
              重新连接
            </Button>
            <Button size="small" onClick={onClear} style={{ marginLeft: 8 }}>
              清空
            </Button>
          </span>
        </div>
        {state === "disconnected" && realtime.lastError && (
          <Alert type="error" showIcon message={realtime.lastError} style={{ marginTop: 12 }} />
        )}
        <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0" }}>
          连接后会加入当前机构的消息组，这里按时间倒序列出服务器推送的所有消息（包括尚未识别的推送方法），用来摸清实时通道的消息格式。
        </Typography.Paragraph>
      </Card>

      <Card size="small" title={`推送消息（${events.length}）`} className="table-card">
        {events.length === 0 ? (
          <Empty description="暂无推送，等待服务器消息…" />
        ) : (
          <div className="event-list">
            {events.map((e, i) => (
              <div key={events.length - i} className="event-item">
                <div>
                  <Tag color="blue">{e.method}</Tag>
                  <Typography.Text type="secondary">{dayjs(e.time).format("HH:mm:ss")}</Typography.Text>
                </div>
                <pre>{typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload, null, 2)}</pre>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
