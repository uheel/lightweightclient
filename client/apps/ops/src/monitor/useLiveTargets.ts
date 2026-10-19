import { useEffect, useRef, useState } from "react";
import { realtime, type DeviceDataMessage } from "@radar/core";

/** 实时轨迹里的一个人（雷达坐标，cm） */
export interface LiveTarget {
  sn: string;
  /** 目标序号（设备给的，同一个人在一段时间内不变） */
  id: number;
  x: number;
  y: number;
  posture?: number;
  at: number;
  /** 这个目标最近的上报间隔（毫秒），画面上用它做补间动画的时长 */
  dt: number;
  /** 最近几秒走过的点（雷达坐标），旧的在前 */
  trail: [number, number][];
}

/** 轨迹保留多久 */
const TRAIL_MS = 20_000;
/** 一台设备超过这么久没有轨迹帧，就当作房间里没人（设备约每秒报一帧，偶尔断几秒） */
const HOLD_MS = 5_000;
/**
 * 平滑：新位置只向上报值靠近一部分，压掉人站着不动时 ±10 cm 左右的抖动。
 * 跳得太远（换了人、雷达重新识别）或者断了一阵再出现，直接用上报值
 */
const SMOOTH = 0.6;
const JUMP_CM = 150;
const GAP_MS = 3_000;
/** 间隔在这个时长内的帧算同一次上报：Ultra 每 2 秒连发两帧（相隔几毫秒、位置差 10–30 cm），合并成一个点，不然每 2 秒跳一下 */
const BURST_MS = 300;
/** 补间时长的范围：设备大约 1 秒一帧 */
const DT_MIN = 200;
const DT_MAX = 1_500;

/**
 * 订阅一组设备的轨迹帧（DeviceData msgType 5），给监控模式画实时位置。
 * 帧格式 [[人数, x, y, z, 姿态, 目标序号, 区域名, 区域序号], ...]；人数为 0 的帧表示没人。
 * 频道订阅由 useLiveMap 负责（监控模式订阅了全部雷达），这里只听消息。
 */
export function useLiveTargets(sns: string[]) {
  const [targets, setTargets] = useState<LiveTarget[]>([]);
  const frames = useRef(new Map<string, { at: number; list: Omit<LiveTarget, "trail">[] }>());
  const trails = useRef(new Map<string, { t: number; p: [number, number] }[]>());
  const intervals = useRef(new Map<string, number>());
  const dirty = useRef(false);
  const key = sns.join(",");

  useEffect(() => {
    const want = new Set(sns);
    frames.current.clear();
    trails.current.clear();
    intervals.current.clear();
    setTargets([]);
    if (!want.size) return;

    const off = realtime.on("DeviceData", (payload) => {
      const m = payload as DeviceDataMessage;
      if (m?.msgType !== 5 || !want.has(m.sn) || !Array.isArray(m.payload)) return;
      const at = Date.now();
      const list = (m.payload.filter(Array.isArray) as unknown[][])
        .filter((t) => Number(t[0]) > 0 && Number.isFinite(Number(t[1])) && Number.isFinite(Number(t[2])))
        .map((t) => {
          const id = Number(t[5]) || 0;
          const k = `${m.sn}#${id}`;
          const tr = trails.current.get(k) ?? [];
          const last = tr[tr.length - 1];
          let x = Number(t[1]);
          let y = Number(t[2]);
          let dt = intervals.current.get(k) ?? 1000;
          if (last && at - last.t <= BURST_MS) {
            // 同一次上报的第二帧：和上一帧取平均，替换掉上一个点，上报间隔不变
            const p: [number, number] = [(last.p[0] + x) / 2, (last.p[1] + y) / 2];
            last.p = p;
            return { sn: m.sn, id, x: p[0], y: p[1], posture: Number.isFinite(Number(t[4])) ? Number(t[4]) : undefined, at: last.t, dt };
          }
          if (last && at - last.t <= GAP_MS && Math.hypot(x - last.p[0], y - last.p[1]) <= JUMP_CM) {
            x = last.p[0] + (x - last.p[0]) * SMOOTH;
            y = last.p[1] + (y - last.p[1]) * SMOOTH;
            // 上报间隔取近几帧的平均，单帧忽快忽慢不影响动画速度
            dt = Math.min(DT_MAX, Math.max(DT_MIN, dt * 0.7 + (at - last.t) * 0.3));
            intervals.current.set(k, dt);
          }
          tr.push({ t: at, p: [x, y] });
          trails.current.set(k, tr);
          return { sn: m.sn, id, x, y, posture: Number.isFinite(Number(t[4])) ? Number(t[4]) : undefined, at, dt };
        });
      frames.current.set(m.sn, { at, list });
      dirty.current = true;
    });

    const tick = setInterval(() => {
      const now = Date.now();
      let changed = dirty.current;
      for (const [sn, f] of frames.current) {
        if (now - f.at > HOLD_MS && f.list.length) {
          frames.current.set(sn, { at: f.at, list: [] });
          changed = true;
        }
      }
      for (const [k, tr] of trails.current) {
        while (tr.length && now - tr[0].t > TRAIL_MS) tr.shift();
        if (!tr.length) {
          trails.current.delete(k);
          intervals.current.delete(k);
        }
      }
      if (!changed) return;
      dirty.current = false;
      setTargets(
        [...frames.current.values()].flatMap((f) =>
          f.list.map((t) => ({ ...t, trail: (trails.current.get(`${t.sn}#${t.id}`) ?? []).map((x) => x.p) })),
        ),
      );
    }, 100);

    return () => {
      off();
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return targets;
}
