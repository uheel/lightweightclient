import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Spin } from "antd";
import { lastSeen } from "../pages/DevicesPage";
import { getCallRecords, type CallRecord, type MasterOption } from "../api/master";

/**
 * 局域网呼叫诊断。局域网模式不注册 SIP 服务器，雷达直接拨"号码@主机IP"，平台也不把主机 IP 下发给雷达，
 * 所以常见的打不通是雷达拨的 IP 根本不是主机（出厂默认 192.168.2.250，或主机换过 IP）。
 * 按通话记录里雷达实际拨的地址和主机 IP 对一下（见 docs/site-analysis.md"局域网和云对讲的区别"）
 */

/** 雷达出厂默认的主机地址，很多没配好的机构都在拨它 */
const DEFAULT_IP = "192.168.2.250";
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** 只看最近这么多次雷达呼出 */
const RECENT = 20;

type Verdict =
  | { kind: "none" }
  | { kind: "ok"; ip: string; name: string; answered: number; total: number }
  | { kind: "default"; ip: string }
  | { kind: "other-master"; ip: string; name: string }
  | { kind: "unknown"; ip: string };

export default function LanDiagnosis({
  d,
  master,
  masters,
  onUseCloud,
}: {
  d: { sn: string; orgId: string };
  /** 选中的所属主机 */
  master?: MasterOption;
  masters: MasterOption[];
  /** 把表单的呼叫方式切到云对讲（还要用户保存） */
  onUseCloud: () => void;
}) {
  const [calls, setCalls] = useState<CallRecord[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    getCallRecords({ orgId: d.orgId }).then(
      (all) => alive && setCalls(all.filter((r) => r.callerSn === d.sn)),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [d.sn, d.orgId]);

  /** 最近几次按 IP 拨出的记录（局域网呼叫），新的在前 */
  const lan = useMemo(
    () =>
      (calls ?? [])
        .map((r) => ({ r, ip: (r.rawCalleeNumber ?? "").split("@")[1] ?? "" }))
        .filter((x) => IP_RE.test(x.ip))
        .sort((a, b) => (b.r.startAt ?? "").localeCompare(a.r.startAt ?? ""))
        .slice(0, RECENT),
    [calls],
  );

  const verdict = useMemo<Verdict>(() => {
    const last = lan[0];
    if (!last) return { kind: "none" };
    const ip = last.ip;
    const hit = masters.find((m) => m.ipAddress === ip);
    // 没选所属主机时（局域网模式紧急号码多是 123456，对不上主机），拨的是机构里某台主机就算对
    if ((master?.ipAddress && ip === master.ipAddress) || (!master && hit)) {
      const same = lan.filter((x) => x.ip === ip);
      return { kind: "ok", ip, name: (master ?? hit)!.deviceName || (master ?? hit)!.sn, answered: same.filter((x) => x.r.status === 1).length, total: same.length };
    }
    if (hit) return { kind: "other-master", ip, name: hit.deviceName || hit.sn };
    if (ip === DEFAULT_IP) return { kind: "default", ip };
    return { kind: "unknown", ip };
  }, [lan, master, masters]);

  if (error) return <Alert type="warning" showIcon message={`读不到通话记录，没法诊断局域网呼叫（${error}）`} />;
  if (!calls)
    return (
      <p className="muted small">
        <Spin size="small" /> 正在按通话记录检查局域网呼叫…
      </p>
    );

  const cloud = (
    <Button size="small" type="link" onClick={onUseCloud} style={{ padding: "0 4px", height: "auto" }}>
      改用云对讲
    </Button>
  );
  const when = lan[0]?.r.startAt ? `最近一次（${lastSeen(lan[0].r.startAt)}）` : "最近";
  const masterIp = master ? (master.ipAddress ? `主机 ${master.deviceName || master.sn} 的 IP 是 ${master.ipAddress}` : `主机 ${master.deviceName || master.sn} 没有上报 IP`) : "还没选所属主机";

  switch (verdict.kind) {
    case "none":
      return (
        <Alert
          type="info"
          showIcon
          message="局域网呼叫诊断：还没有这台雷达按 IP 呼出的记录"
          description="局域网模式下雷达直接拨“号码@主机IP”，不经过 SIP 服务器。按一次呼救按钮或喊唤醒词后再来看，就能知道它拨的是不是主机。"
        />
      );
    case "ok":
      return (
        <Alert
          type="success"
          showIcon
          message={`局域网呼叫诊断：${when}拨的是 ${verdict.ip}，就是主机 ${verdict.name}`}
          description={
            <>
              最近 {verdict.total} 次拨这个地址，接通 {verdict.answered} 次。
              {!verdict.answered && <>地址是对的但一次都没接通：检查主机是否在线、雷达和主机之间网络是否可达（防火墙、VLAN 隔离），或者{cloud}。</>}
            </>
          }
        />
      );
    default:
      return (
        <Alert
          type="error"
          showIcon
          message={`局域网呼叫诊断：${when}拨的是 ${verdict.ip}，${master ? "不是所属主机" : "不是机构里的主机"}`}
          description={
            <>
              {verdict.kind === "default" && `${DEFAULT_IP} 是雷达出厂默认的主机地址，说明雷达从没拿到过主机的 IP。`}
              {verdict.kind === "other-master" && `这是主机 ${verdict.name} 的地址，雷达还在拨以前的主机。`}
              {verdict.kind === "unknown" && "这个地址不是机构里任何主机的 IP，主机可能换过 IP（例如 DHCP 重新分配）。"}
              {masterIp}。平台不会把主机 IP 下发给雷达，局域网模式很难保证拨对。建议{cloud}：雷达和主机都注册到 SIP 服务器，按号码转接，不依赖 IP。
            </>
          }
        />
      );
  }
}
