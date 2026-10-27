import { useEffect, useState } from "react";
import { Modal, QRCode, Typography } from "antd";
import { api, session, SERVERS } from "@radar/core";

interface WatchSettings {
  mqttServer?: string;
  mqttPort?: number;
  sipServer?: string;
}

/**
 * 护工手表的配置码，和平台"护工手表管理"的"基础配置"一样：二维码里只有一个地址，
 * 手表扫了去请求它，拿到 MQTT、SIP 服务器后连上平台。地址不分机构，所有手表扫同一个
 */
export default function WatchSetupQr({ open, onClose }: { open: boolean; onClose: () => void }) {
  const url = `${session.get()?.server || SERVERS[0].value}/api/caregiver-watch/device-settings`;
  const [cfg, setCfg] = useState<WatchSettings>();

  useEffect(() => {
    if (!open || cfg) return;
    api.get<WatchSettings>("/api/caregiver-watch/device-settings").then((r) => setCfg(r.data)).catch(() => {});
  }, [open]);

  return (
    <Modal title="护工手表配置码" open={open} onCancel={onClose} footer={null} width={420} centered>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <QRCode value={url} size={280} errorLevel="H" />
        <p className="muted small" style={{ margin: 0, textAlign: "center" }}>
          在手表上扫这个码，手表会从平台取服务器设置并连上平台。所有护工手表扫的是同一个码。
        </p>
        <Typography.Text className="mono small" copyable>
          {url}
        </Typography.Text>
        {cfg && (
          <p className="muted small" style={{ margin: 0 }}>
            手表会拿到：MQTT {cfg.mqttServer}:{cfg.mqttPort} · SIP {cfg.sipServer}
          </p>
        )}
      </div>
    </Modal>
  );
}
