import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

/** 一次呼吸的形状：吸气快、呼气慢，末尾有短暂停顿。p ∈ [0,1)，返回 0..1 */
function breath(p: number) {
  if (p < 0.38) return (1 - Math.cos((Math.PI * p) / 0.38)) / 2;
  const k = 3.6;
  const q = (p - 0.38) / 0.62;
  return (Math.exp(-k * q) - Math.exp(-k)) / (1 - Math.exp(-k));
}

const PERIOD = 4.2; // 秒/次，约 14 次/分
const SPEED = 64; // 走纸速度 px/s
const REVEAL = 1.6; // 首次绘出用时（秒）
const PAD = 72; // 画布上下各多留的空白，给拨弦和深吸气的幅度用，不占布局
const SHAKE = 0.95; // 拨弦震动时长（秒）
const SETTLE = 1.0; // 登录成功收线时长（秒）
const ALERT = "#D9363E";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 两个 #RRGGBB 按 t 混合 */
function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t));
  return "#" + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

export interface BreathTraceHandle {
  /** 像拨了一下弦：整条线震一下并泛红，strength 0..1 */
  shake(strength?: number): void;
  /** 深吸一口气后把线拉直，落在基线上。完成时 resolve 这条直线在视口里的 y */
  settle(): Promise<number>;
}

/**
 * 登录页的呼吸波形：模拟雷达隔空读到的一条呼吸曲线，横贯整个窗口。
 * 写笔停在右侧，左侧渐隐；开启"减少动态效果"时只画一帧静态曲线。
 * 登录失败时 shake()，登录成功时 settle()。
 */
export function BreathTrace({
  color,
  height = 120,
  ref: handleRef,
}: {
  color: string;
  height?: number;
  ref?: Ref<BreathTraceHandle>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fx = useRef<{
    shakeAt?: number;
    shakeAmp: number;
    settleAt?: number;
    onSettled?: () => void;
    redraw?: () => void;
  }>({ shakeAmp: 1 });
  const still = useRef(false);

  const baselineY = () => {
    const r = ref.current?.getBoundingClientRect();
    return r ? r.top + PAD + height / 2 + height * 0.27 : 0;
  };

  useImperativeHandle(handleRef, () => ({
    shake(strength = 1) {
      fx.current.shakeAt = performance.now();
      fx.current.shakeAmp = strength;
      fx.current.redraw?.();
    },
    settle() {
      if (still.current) return Promise.resolve(baselineY());
      return new Promise<number>((resolve) => {
        fx.current.settleAt = performance.now();
        fx.current.onSettled = () => resolve(baselineY());
      });
    },
  }));

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    still.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isStill = still.current;
    const f = fx.current;
    let w = 0;
    let raf = 0;
    const t0 = performance.now();
    const H = height + PAD * 2;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(H * dpr);
    };

    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, H);
      ctx.translate(0, PAD);

      const elapsed = (now - t0) / 1000;
      const mid = height / 2;
      const amp = height * 0.27;
      const base = mid + amp;

      // 登录成功：深吸一口气（幅度鼓起、走纸加速），随后线被拉直落到基线，写笔冲到右边缘
      const st = f.settleAt === undefined ? -1 : (now - f.settleAt) / 1000 / SETTLE;
      const s = clamp01(st);
      const swell = st < 0 ? 1 : 1 + 0.85 * Math.sin(Math.PI * clamp01(s / 0.55));
      const flat = st < 0 ? 0 : smooth(0.38, 0.9, s);
      const rush = st < 0 ? 0 : 2.4 * s * s * s;

      // 登录失败：拨弦，两端不动、中间震，几次来回后衰减；颜色短暂泛红
      const sh = f.shakeAt === undefined ? -1 : (now - f.shakeAt) / 1000;
      const shaking = sh >= 0 && sh < SHAKE;
      const decay = shaking ? Math.exp(-sh / 0.24) : 0;
      const tint = sh >= 0 ? Math.exp(-sh / 0.45) * (sh < 1.6 ? 1 : 0) : 0;
      const ink = tint > 0.01 ? mix(color, ALERT, tint) : color;

      const t = isStill ? 0 : elapsed + rush;
      const head = Math.round(lerp(w * 0.8, w + 12, smooth(0.15, 0.85, s)));
      const reveal = isStill ? w : w * (1 - (1 - Math.min(1, elapsed / REVEAL)) ** 3);

      // 写笔右侧：尚未发生的时间，只留一条虚的基线
      if (flat < 1) {
        ctx.setLineDash([2, 6]);
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.28 * (1 - flat);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(head + 10, base);
        ctx.lineTo(Math.min(w, reveal), base);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // 写笔左侧：已经读到的呼吸。收线时左侧渐隐也一起褪掉，变成一整条实线
      const grad = ctx.createLinearGradient(0, 0, Math.max(head, 1), 0);
      const hex = (a: number) => ink + Math.round(clamp01(a) * 255).toString(16).padStart(2, "0");
      grad.addColorStop(0, hex(flat));
      grad.addColorStop(0.45, hex(lerp(0x88 / 255, 1, flat)));
      grad.addColorStop(1, ink);
      ctx.strokeStyle = grad;
      ctx.lineWidth = lerp(1.6, 2, flat);
      ctx.lineJoin = "round";
      ctx.beginPath();
      const end = Math.min(head, reveal);
      const k = 2 * Math.PI * 7.5; // 拨弦基频 7.5Hz
      let headY = base;
      for (let x = 0; x <= end; x += 2) {
        const ts = t - (head - x) / SPEED;
        const depth = 1 + 0.14 * Math.sin(ts * 0.31) + 0.06 * Math.sin(ts * 1.07);
        let y = base - 2 * amp * depth * 0.92 * swell * breath((((ts / PERIOD) % 1) + 1) % 1);
        y = lerp(y, base, flat);
        if (shaking && !isStill) {
          const u = x / Math.max(end, 1);
          y +=
            30 *
            f.shakeAmp *
            decay *
            (Math.sin(Math.PI * u) * Math.cos(k * sh) + 0.35 * Math.sin(3 * Math.PI * u) * Math.cos(2.6 * k * sh + 1));
        }
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        headY = y;
      }
      ctx.stroke();

      if (reveal >= w * 0.8 && flat < 1) {
        ctx.fillStyle = ink;
        ctx.globalAlpha = 1 - flat;
        ctx.beginPath();
        ctx.arc(head, headY, 3.5 + 2 * tint, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = (0.14 + 0.16 * tint) * (1 - flat);
        ctx.beginPath();
        ctx.arc(head, headY, 9 + 8 * tint, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (st >= 1 && f.onSettled) {
        const done = f.onSettled;
        f.onSettled = undefined;
        done();
      }
      if (!isStill) raf = requestAnimationFrame(draw);
    };

    resize();
    f.redraw = isStill ? () => draw(performance.now()) : undefined;
    const ro = new ResizeObserver(() => {
      resize();
      if (isStill) draw(performance.now());
    });
    ro.observe(canvas);
    raf = requestAnimationFrame(draw);
    // 静态模式下泛红要能褪回来
    let fade = 0;
    if (isStill) fade = window.setInterval(() => f.shakeAt !== undefined && draw(performance.now()), 100);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(fade);
      ro.disconnect();
    };
  }, [color, height]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: height + PAD * 2, margin: `${-PAD}px 0`, pointerEvents: "none" }}
    />
  );
}
