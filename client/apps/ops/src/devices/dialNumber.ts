/**
 * 雷达拨手机号时要按 SIP 服务器加前缀，用户只输入、只看到 11 位手机号，前缀在客户端里加和去掉。
 * 规则来自 2026-10-22 全部机构的通话记录（见 docs/site-analysis.md"紧急号码和场景的关系"）：
 * 经 sip.igoodlife.com（申瓯）拨手机全是 0 + 手机号，经 rtcdev.ucpaas.com 全是 0086 + 手机号，
 * 不分本地外地；从没出现过直接拨 11 位的
 */

const MOBILE = /^1[3-9]\d{9}$/;

/** 拨手机号的前缀，按雷达的 SIP 服务器；不知道服务器时按平台默认的申瓯 */
export function mobilePrefix(sipServer?: string) {
  return /ucpaas/i.test(sipServer ?? "") ? "0086" : "0";
}

/** 用户输入 → 设备上存的号码：11 位手机号加前缀，其他（SIP 号、已带前缀的）原样 */
export function toDialNumber(input: string, sipServer?: string) {
  const n = input.trim().replace(/[\s-]/g, "");
  return MOBILE.test(n) ? mobilePrefix(sipServer) + n : n;
}

/** 设备上存的号码 → 给用户看的：去掉手机号前面的 0 / 0086 / +86 / 86 */
export function toShownNumber(stored?: unknown) {
  const n = String(stored ?? "").trim();
  const m = n.match(/^(?:0086|\+86|86|0)(1[3-9]\d{9})$/);
  return m ? m[1] : n;
}

export const isMobileNumber = (stored?: unknown) => MOBILE.test(toShownNumber(stored));
