import { memo, useEffect, useRef, useState } from "react";
import { Checkbox, Segmented } from "antd";
import { ANGLE_STD, attitudeFromAngles, AXES, AXIS_COLOR, deg, GRADE_COLOR, v3, type Axis, type evaluate, type V3 } from "../angle";

type Ev = ReturnType<typeof evaluate>;
type Sample = Record<Axis, number>;
type Preset = "default" | "front" | "side" | "top";

const PRESETS: Record<Preset, [number, number, number]> = {
  default: [-0.75, 0.32, 1],
  front: [0, 0, 1],
  side: [Math.PI / 2, 0, 1],
  top: [-0.75, 1.5, 1],
};
const FONT = '"Noto Sans SC", "Microsoft YaHei", sans-serif';
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * 空间姿态（移植自油猴脚本 room-install-angle 的 3D 视图）：设备盒子 + 三个坐标轴，
 * 虚线为标准姿态，弧线标出各轴与水平面的夹角。拖动旋转、滚轮缩放、双击复位。
 */
export default memo(function AttitudeView({ sample, ev, type }: { sample?: Sample; ev?: Ev; type: number }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ yaw: PRESETS.default[0], pitch: PRESETS.default[1], zoom: 1 });
  const [opts, setOpts] = useState({ angles: true, std: true });
  const [preset, setPreset] = useState<Preset | "">("default");
  const render = useRef<() => void>(() => {});
  const raf = useRef(0);
  /** 合并到下一帧再画：拖动时鼠标事件比帧率高得多，每个事件都重画会卡顿 */
  const draw = useRef(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      render.current();
    });
  });

  // 每次渲染更新绘制函数（数据、选项变化后重画）
  render.current = () => {
    const cv = canvas.current;
    const st = stage.current;
    if (!cv || !st) return;
    const W = st.clientWidth;
    const H = st.clientHeight;
    const r = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * r) || cv.height !== Math.round(H * r)) {
      cv.width = Math.max(1, Math.round(W * r));
      cv.height = Math.max(1, Math.round(H * r));
      cv.style.width = W + "px";
      cv.style.height = H + "px";
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const v = view.current;

    // 相机绕原点旋转：yaw 绕竖直轴，pitch 为仰视角；带轻微透视
    const proj = (p: V3) => {
      const cy = Math.cos(v.yaw);
      const sy = Math.sin(v.yaw);
      const cp = Math.cos(v.pitch);
      const sp = Math.sin(v.pitch);
      const x1 = p[0] * cy - p[1] * sy;
      const y1 = p[0] * sy + p[1] * cy;
      const z1 = p[2];
      const depth = y1 * cp - z1 * sp;
      const up = y1 * sp + z1 * cp;
      const s = Math.min(W, H) * 0.3 * v.zoom * (6 / (6 + depth));
      return [W / 2 + x1 * s, H * 0.6 - up * s, depth] as const;
    };
    const line = (a: V3, b: V3, color: string, width: number, dash: number[] = []) => {
      const p = proj(a);
      const q = proj(b);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const label = (p3: V3, text: string, color: string, border?: string) => {
      const [x, y] = proj(p3);
      ctx.font = `12px ${FONT}`;
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = "rgba(255,255,255,.94)";
      ctx.strokeStyle = border ?? "#E8EAF2";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 10, w, 20, 4);
      else ctx.rect(x - w / 2, y - 10, w, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(text, x, y + 1);
      ctx.textAlign = "left";
    };

    // 水平参考面与网格
    const FLOOR = -0.95;
    const PS = 1.5;
    const corners = ([[-PS, -PS, FLOOR], [PS, -PS, FLOOR], [PS, PS, FLOOR], [-PS, PS, FLOOR]] as V3[]).map(proj);
    ctx.fillStyle = "rgba(59,79,216,.07)";
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1])));
    ctx.closePath();
    ctx.fill();
    for (let g = -PS; g <= PS + 1e-6; g += PS / 4) {
      line([g, -PS, FLOOR], [g, PS, FLOOR], "rgba(17,20,65,.07)", 1);
      line([-PS, g, FLOOR], [PS, g, FLOOR], "rgba(17,20,65,.07)", 1);
    }
    label([PS, -PS, FLOOR], "水平参考面", "#8A8FA8");
    line([0, 0, FLOOR], [0, 0, 1.55], "rgba(27,29,46,.4)", 1.5, [5, 5]);
    label([0, 0, 1.65], "竖直向上", "#5B6078");

    if (!sample || !ev) {
      ctx.fillStyle = "#8A8FA8";
      ctx.font = `13px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("暂无角度数据", W / 2, H / 2);
      ctx.textAlign = "left";
      return;
    }
    const att = attitudeFromAngles(sample.x, sample.y, sample.z);
    const std = ANGLE_STD[type];
    const stdAtt = attitudeFromAngles(std.axes.x, std.axes.y, std.axes.z);

    // 设备盒子：x 宽、y 长、z 薄，半透明面按深度从远到近绘制
    const half = { x: 0.38, y: 0.72, z: 0.16 };
    const P = (sx: number, sy: number, sz: number) => v3.add(v3.add(v3.scale(att.x, sx * half.x), v3.scale(att.y, sy * half.y)), v3.scale(att.z, sz * half.z));
    const faceDefs: [V3, V3, V3, V3, V3][] = [
      [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1], att.x],
      [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], v3.scale(att.x, -1)],
      [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1], att.y],
      [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], v3.scale(att.y, -1)],
      [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], att.z],
      [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1], v3.scale(att.z, -1)],
    ];
    const faces = faceDefs
      .map((f) => {
        const pts = f.slice(0, 4).map((c) => proj(P(c[0], c[1], c[2])));
        return { pts, n: f[4], depth: pts.reduce((s, p) => s + p[2], 0) / 4 };
      })
      .sort((a, b) => b.depth - a.depth);
    const light = v3.norm([0.35, -0.5, 0.8]);
    for (const f of faces) {
      const b = 0.75 + 0.25 * Math.max(0, v3.dot(f.n, light));
      ctx.fillStyle = `rgba(${Math.round(196 * b)},${Math.round(204 * b)},${Math.round(240 * b)},.78)`;
      ctx.strokeStyle = "rgba(59,79,216,.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      f.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    const c0 = proj([0, 0, 0]);
    ctx.fillStyle = "#26339A";
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("RADAR", c0[0], c0[1] + 18);
    ctx.textAlign = "left";

    const LEN = 1.35;
    if (opts.std) {
      for (const k of AXES) {
        line([0, 0, 0], v3.scale(stdAtt[k], LEN), AXIS_COLOR[k] + "88", 1.5, [6, 5]);
        label(v3.scale(stdAtt[k], LEN + 0.3), `标准 ${k.toUpperCase()}`, AXIS_COLOR[k] + "cc");
      }
    }
    // 角度标注：轴到水平面的投影（虚线）+ 夹角弧线 + 数值
    if (opts.angles) {
      const radius: Record<Axis, number> = { x: 0.55, y: 0.75, z: 0.95 };
      for (const k of AXES) {
        const a = att[k];
        const g = ev.axes.find((x) => x.k === k)!.grade;
        const hl = Math.hypot(a[0], a[1]);
        if (hl < 0.02) {
          // 接近竖直，投影方向不确定，直接标在轴旁边
          label(v3.add(v3.scale(a, 0.85), [0.28, 0, 0]), `${k} ${deg(sample[k])}`, AXIS_COLOR[k], GRADE_COLOR[g]);
          continue;
        }
        const h: V3 = [a[0] / hl, a[1] / hl, 0];
        const alpha = Math.asin(clamp(a[2], -1, 1));
        const R = radius[k];
        line([0, 0, 0], v3.scale(h, R + 0.2), AXIS_COLOR[k] + "66", 1, [3, 4]);
        ctx.strokeStyle = AXIS_COLOR[k];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const b = (alpha * i) / 24;
          const p = proj(v3.add(v3.scale(h, R * Math.cos(b)), [0, 0, R * Math.sin(b)]));
          if (i) ctx.lineTo(p[0], p[1]);
          else ctx.moveTo(p[0], p[1]);
        }
        ctx.stroke();
        const mid = v3.add(v3.scale(h, (R + 0.08) * Math.cos(alpha / 2)), [0, 0, (R + 0.08) * Math.sin(alpha / 2)]);
        label(mid, `${k} ${deg(sample[k])}`, AXIS_COLOR[k], GRADE_COLOR[g]);
      }
    }
    // 实际坐标轴
    for (const k of AXES) {
      const end = v3.scale(att[k], LEN);
      line([0, 0, 0], end, AXIS_COLOR[k], 2.5);
      const p = proj(end);
      ctx.fillStyle = AXIS_COLOR[k];
      ctx.beginPath();
      ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `14px ${FONT}`;
      ctx.fillText(`+${k.toUpperCase()}`, p[0] + 9, p[1] - 6);
    }
  };

  useEffect(() => {
    draw.current();
  });

  // 交互：拖动旋转、滚轮缩放、双击复位；尺寸变化时重画
  useEffect(() => {
    const st = stage.current!;
    const ro = new ResizeObserver(() => draw.current());
    ro.observe(st);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.zoom = clamp(view.current.zoom * Math.exp(-e.deltaY * 0.0015), 0.4, 3);
      draw.current();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      st.setPointerCapture(e.pointerId);
      st.classList.add("dragging");
      setPreset((p) => (p ? "" : p));
      let lx = e.clientX;
      let ly = e.clientY;
      const move = (ev: PointerEvent) => {
        view.current.yaw += (ev.clientX - lx) * 0.008;
        view.current.pitch = clamp(view.current.pitch + (ev.clientY - ly) * 0.008, -0.6, 1.55);
        lx = ev.clientX;
        ly = ev.clientY;
        draw.current();
      };
      const up = () => {
        st.classList.remove("dragging");
        st.removeEventListener("pointermove", move);
        st.removeEventListener("pointerup", up);
      };
      st.addEventListener("pointermove", move);
      st.addEventListener("pointerup", up);
    };
    st.addEventListener("wheel", onWheel, { passive: false });
    st.addEventListener("pointerdown", onDown);
    return () => {
      // 取消后要清零，否则之后的 draw 会以为还有一帧在排队而一直不画（开发模式 StrictMode 会先卸载再挂载一次）
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      ro.disconnect();
      st.removeEventListener("wheel", onWheel);
      st.removeEventListener("pointerdown", onDown);
    };
  }, []);

  const applyPreset = (p: Preset) => {
    const [yaw, pitch, zoom] = PRESETS[p];
    view.current = { yaw, pitch, zoom };
    setPreset(p);
    draw.current();
  };

  return (
    <div className="attitude">
      <div className="attitude-stage" ref={stage} onDoubleClick={() => applyPreset("default")}>
        <canvas ref={canvas} />
      </div>
      <div className="attitude-tools">
        <Segmented
          value={preset}
          onChange={(v) => applyPreset(v as Preset)}
          options={[
            { label: "默认", value: "default" },
            { label: "正视", value: "front" },
            { label: "侧视（沿 x 轴）", value: "side" },
            { label: "俯视", value: "top" },
          ]}
        />
        <Checkbox checked={opts.angles} onChange={(e) => setOpts((o) => ({ ...o, angles: e.target.checked }))}>
          角度标注
        </Checkbox>
        <Checkbox checked={opts.std} onChange={(e) => setOpts((o) => ({ ...o, std: e.target.checked }))}>
          标准姿态（虚线）
        </Checkbox>
        <span className="muted small" style={{ marginLeft: "auto" }}>
          拖动旋转 · 滚轮缩放 · 双击复位
        </span>
      </div>
    </div>
  );
});
