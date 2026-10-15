import { useEffect, useRef } from "react";

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

/**
 * 登录页的呼吸波形：模拟雷达隔空读到的一条呼吸曲线，横贯整个窗口。
 * 写笔停在右侧，左侧渐隐；开启"减少动态效果"时只画一帧静态曲线。
 */
export function BreathTrace({ color, height = 120 }: { color: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let raf = 0;
    const t0 = performance.now();

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number) => {
      const elapsed = (now - t0) / 1000;
      const t = still ? 0 : elapsed;
      const head = Math.round(w * 0.8);
      const reveal = still ? w : w * (1 - (1 - Math.min(1, elapsed / REVEAL)) ** 3);
      const mid = height / 2;
      const amp = height * 0.27;

      ctx.clearRect(0, 0, w, height);

      // 写笔右侧：尚未发生的时间，只留一条虚的基线
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(head + 10, mid + amp);
      ctx.lineTo(Math.min(w, reveal), mid + amp);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // 写笔左侧：已经读到的呼吸
      const grad = ctx.createLinearGradient(0, 0, head, 0);
      grad.addColorStop(0, color + "00");
      grad.addColorStop(0.45, color + "88");
      grad.addColorStop(1, color);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const end = Math.min(head, reveal);
      let headY = mid;
      for (let x = 0; x <= end; x += 2) {
        const ts = t - (head - x) / SPEED;
        const depth = 1 + 0.14 * Math.sin(ts * 0.31) + 0.06 * Math.sin(ts * 1.07);
        const y = mid + amp - 2 * amp * depth * 0.92 * breath((((ts / PERIOD) % 1) + 1) % 1);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        headY = y;
      }
      ctx.stroke();

      if (reveal >= head) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(head, headY, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.14;
        ctx.beginPath();
        ctx.arc(head, headY, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (!still) raf = requestAnimationFrame(draw);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (still) draw(performance.now());
    });
    ro.observe(canvas);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [color, height]);

  return <canvas ref={ref} aria-hidden="true" style={{ display: "block", width: "100%", height }} />;
}
