import type { Heartbeat } from "../api/device";

/**
 * 安装角度标准（与油猴脚本 room-install-angle 一致）。angle_* 是加速度计各轴与水平面的夹角。
 * 侧装只绕 x 轴下倾：angle_y + angle_z = 90°，angle_y 标准 68°，即俯角 22°。
 */
export const ANGLE_STD: Record<number, { name: string; tol: number; axes: Record<Axis, number> }> = {
  0: { name: "顶装", tol: 2, axes: { x: 0, y: 0, z: 90 } },
  1: { name: "侧装", tol: 2, axes: { x: 0, y: 68, z: 22 } },
};

export type Axis = "x" | "y" | "z";
export const AXES: Axis[] = ["x", "y", "z"];
export type Grade = "ok" | "warn" | "bad";

export const GRADE_TEXT: Record<Grade, string> = { ok: "合格", warn: "接近临界", bad: "超出范围" };

/** 超过允许偏差 = 不合格；超过 75% = 接近临界 */
export function evaluate(h: Pick<Heartbeat, Axis>, installType: number) {
  const std = ANGLE_STD[installType] ?? ANGLE_STD[1];
  let grade = "ok" as Grade;
  const axes = AXES.map((k) => {
    const dev = h[k] - std.axes[k];
    const a = Math.abs(dev);
    const g: Grade = a > std.tol ? "bad" : a > std.tol * 0.75 ? "warn" : "ok";
    if (g === "bad" || (g === "warn" && grade === "ok")) grade = g;
    return { k, value: h[k], std: std.axes[k], dev, grade: g };
  });
  return { grade, axes, tol: std.tol, name: std.name };
}

/** 心跳间隔：最近 12 次上报间隔的中位数（10 秒 ~ 10 分钟），用来预计下次上报、判断折线断开 */
export function heartbeatInterval(list: { t: number }[]) {
  if (list.length < 3) return 60e3;
  const diffs: number[] = [];
  for (let i = Math.max(1, list.length - 12); i < list.length; i++) diffs.push(list[i].t - list[i - 1].t);
  diffs.sort((a, b) => a - b);
  return Math.max(10e3, Math.min(10 * 60e3, diffs[diffs.length >> 1]));
}

export type V3 = [number, number, number];
export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

/**
 * 由三个轴与水平面的夹角还原设备姿态，返回设备 x/y/z 轴在世界坐标（东、北、上）中的方向。
 * 加速度计只能确定倾斜，不能确定绕竖直轴的朝向，这里固定让设备 x 轴的水平投影朝东。
 */
export function attitudeFromAngles(ax: number, ay: number, az: number): Record<Axis, V3> {
  const r = Math.PI / 180;
  const up = v3.norm([Math.sin(ax * r), Math.sin(ay * r), Math.sin(az * r)]); // 竖直向上在设备坐标系中的方向
  const ref: V3 = Math.abs(up[0]) < 0.95 ? [1, 0, 0] : [0, 1, 0];
  const h1 = v3.norm(v3.add(ref, v3.scale(up, -v3.dot(ref, up))));
  const h2 = v3.cross(up, h1);
  return { x: [h1[0], h2[0], up[0]], y: [h1[1], h2[1], up[1]], z: [h1[2], h2[2], up[2]] };
}

export const GRADE_COLOR: Record<Grade, string> = { ok: "#1F9D55", warn: "#D97706", bad: "#D93036" };
export const AXIS_COLOR: Record<Axis, string> = { x: "#D93036", y: "#1F9D55", z: "#3B4FD8" };
export const deg = (v: number | null | undefined, n = 1) => (v == null || !isFinite(v) ? "--" : `${v.toFixed(n)}°`);
export const signed = (v: number | null | undefined, n = 1) => (v == null || !isFinite(v) ? "--" : `${v > 0 ? "+" : ""}${v.toFixed(n)}°`);
