import { assetUrl } from "@radar/core";
import { clamp, EVENTS, fmt, fmtTime, interpAt, linked, lowerBound, postureAt, POSTURES, trackStateAt, type ReplayData, type RoomDetail, type RoomEl } from "./data";

/**
 * 姿态回放的画布部分（移植自油猴脚本 room-posture-replay.user.js）：房间平面图 + 可缩放时间轴 + 播放。
 * 画布每帧重绘，不经过 React；界面上的按钮、列表由 ReplayView 渲染，通过回调同步当前时间。
 */

export interface ReplayOptions {
  speed: number;
  /** 尾迹秒数，0 = 无 */
  trail: number;
  /** 播放时跳过无人时段 */
  skip: boolean;
  /** 播放头离开视图时时间轴跟随 */
  follow: boolean;
}

export interface ReplayEls {
  stage: HTMLDivElement;
  roomBase: HTMLCanvasElement;
  roomDyn: HTMLCanvasElement;
  tlWrap: HTMLDivElement;
  tlBase: HTMLCanvasElement;
  tlOver: HTMLCanvasElement;
  tip: HTMLDivElement;
}

export interface ReplayCallbacks {
  /** 当前时间变化（播放中约 150ms 一次） */
  onTime: (t: number) => void;
  onPlaying: (playing: boolean) => void;
  onView: (spanText: string) => void;
}

const TICK_STEPS = [1e3, 2e3, 5e3, 1e4, 15e3, 3e4, 6e4, 12e4, 3e5, 6e5, 9e5, 18e5, 36e5, 72e5, 108e5, 216e5, 432e5, 864e5];
const TL = { GUTTER: 112, RIGHT: 12, OV_Y: 4, OV_H: 10, AXIS_Y: 18, AXIS_H: 30, DENS_H: 18, LANE_H: 16, LANE_GAP: 4, EV_H: 14 };
const MIN_VIEW_SPAN = 5000;
const FONT = '12px "Noto Sans SC", "Microsoft YaHei", sans-serif';
const C = {
  text: "#1B1D2E",
  muted: "#8A8FA8",
  line: "#E8EAF2",
  lane: "#F6F7FB",
  run: "#D5D8E6",
  primary: "#3B4FD8",
  density: "#8C9BF5",
  overview: "#B8C2FA",
  head: "#D93036",
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function fmtSpan(ms: number) {
  if (ms < 6e4) return `${Math.round(ms / 1000)} 秒`;
  if (ms < 36e5) return `${(ms / 6e4).toFixed(ms < 6e5 ? 1 : 0)} 分钟`;
  if (ms < 864e5) return `${(ms / 36e5).toFixed(1)} 小时`;
  return `${(ms / 864e5).toFixed(1)} 天`;
}

export class ReplayEngine {
  detail: RoomDetail | null = null;
  data: ReplayData | null = null;
  q0: number;
  q1: number;
  v0: number;
  v1: number;
  t: number;
  playing = false;

  private raf = 0;
  private lastFrame = 0;
  private lastNotify = 0;
  private lastSpan = "";
  private room = { scale: 1, ox: 0, oy: 0 };
  private images = new Map<string, HTMLImageElement>();
  private hover: { x: number; y: number } | null = null;
  private ro: ResizeObserver;
  private off: (() => void)[] = [];

  constructor(
    private els: ReplayEls,
    private opts: () => ReplayOptions,
    private cb: ReplayCallbacks,
    range: [number, number],
  ) {
    [this.q0, this.q1] = range;
    this.v0 = this.q0;
    this.v1 = this.q1;
    this.t = this.q0;
    // 只在尺寸真的变了时才重设画布：重设会清空画布（闪一下），房间视图也会被重置成自适应
    let stageSize = "";
    let tlWidth = -1;
    this.ro = new ResizeObserver(() => {
      const ss = `${els.stage.clientWidth}x${els.stage.clientHeight}`;
      if (ss !== stageSize) {
        stageSize = ss;
        this.resizeRoom();
      }
      if (els.tlWrap.clientWidth !== tlWidth) {
        tlWidth = els.tlWrap.clientWidth;
        this.resizeTimeline();
      }
    });
    this.ro.observe(els.stage);
    this.ro.observe(els.tlWrap);
    this.bindRoom();
    this.bindTimeline();
    this.resizeTimeline();
  }

  destroy() {
    // 先停掉播放标记：已排队的 tick 看到它就不再续帧（开发时热替换后不会留下两份引擎同时在跑）
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const f of this.off) f();
  }

  private listen<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions) {
    el.addEventListener(type, fn, opt);
    this.off.push(() => el.removeEventListener(type, fn, opt));
  }

  // ---------- 外部调用 ----------

  setDetail(d: RoomDetail | null) {
    this.detail = d;
    this.resizeRoom();
  }

  setData(data: ReplayData, q0: number, q1: number) {
    this.pause();
    this.data = data;
    this.q0 = q0;
    this.q1 = q1;
    this.resizeTimeline();
    this.fitData();
    const first = data.allTs.length ? data.allTs[0] : data.marks[0] ? data.marks[0].t : q0;
    this.seek(Math.max(q0, first - 1000));
  }

  /** 重绘（选项变化后调用） */
  refresh() {
    this.renderFrame(true);
  }

  // ---------- 房间画布 ----------

  private sizeCanvas(cv: HTMLCanvasElement, w: number, h: number) {
    const r = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(w * r));
    cv.height = Math.max(1, Math.round(h * r));
    cv.style.width = w + "px";
    cv.style.height = h + "px";
  }

  private roomBounds() {
    const bg = this.detail?.background ?? { width: 400, height: 400 };
    return { x: 0, y: 0, w: bg.width || 400, h: bg.height || 400 };
  }

  fitRoom() {
    const W = this.els.stage.clientWidth;
    const H = this.els.stage.clientHeight;
    const m = 32;
    const b = this.roomBounds();
    const scale = Math.max(0.05, Math.min((W - 2 * m) / b.w, (H - 2 * m) / b.h));
    this.room = { scale, ox: (W - b.w * scale) / 2 - b.x * scale, oy: (H - b.h * scale) / 2 - b.y * scale };
    this.drawRoomBase();
    this.drawRoomDyn();
  }

  private resizeRoom() {
    const W = this.els.stage.clientWidth;
    const H = this.els.stage.clientHeight;
    this.sizeCanvas(this.els.roomBase, W, H);
    this.sizeCanvas(this.els.roomDyn, W, H);
    if (this.detail) this.fitRoom();
  }

  zoomRoom(factor: number, cx = this.els.stage.clientWidth / 2, cy = this.els.stage.clientHeight / 2) {
    const r = this.room;
    const scale = clamp(r.scale * factor, 0.05, 20);
    const k = scale / r.scale;
    this.room = { scale, ox: cx - k * (cx - r.ox), oy: cy - k * (cy - r.oy) };
    this.drawRoomBase();
    this.drawRoomDyn();
  }

  private getImage(src?: string) {
    if (!src) return null;
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => this.drawRoomBase();
      img.onerror = () => console.warn("[姿态回放] 图片加载失败", src, img!.src);
      img.src = assetUrl(src);
      this.images.set(src, img);
    }
    return img;
  }

  private worldTransform(ctx: CanvasRenderingContext2D) {
    const r = window.devicePixelRatio || 1;
    const v = this.room;
    ctx.setTransform(r * v.scale, 0, 0, r * v.scale, r * v.ox, r * v.oy);
  }

  private drawElement(ctx: CanvasRenderingContext2D, el: RoomEl, s: number) {
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    const img = this.getImage(el.src);
    const qc = el.qingLanConfig;
    ctx.save();
    if (el.type === 3 && qc?.container) {
      // 与平台一致：雷达图标以中心对齐，位置取 radar + container（不是元素自身的 x/y）
      ctx.translate((qc.radar?.x ?? 0) + qc.container.x, (qc.radar?.y ?? 0) + qc.container.y);
      if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
      if (img?.complete && img.naturalWidth) ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
      return;
    }
    ctx.translate(el.x ?? 0, el.y ?? 0);
    if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
    if (el.scaleX || el.scaleY) ctx.scale(el.scaleX || 1, el.scaleY || 1);
    if (el.opacity != null) ctx.globalAlpha = el.opacity;
    if (el.type === 1) {
      for (const child of el.children ?? []) this.drawElement(ctx, child, s);
    } else if (el.type === 5) {
      ctx.fillStyle = el.fill || "#000";
      ctx.font = `${el.fontSize || 14}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(el.text || "", 0, 0);
    } else if (el.type === 6 && Array.isArray(el.points)) {
      ctx.strokeStyle = el.stroke || "#333";
      ctx.lineWidth = el.strokeWidth || 1;
      ctx.beginPath();
      for (let i = 0; i + 1 < el.points.length; i += 2) {
        if (i) ctx.lineTo(el.points[i], el.points[i + 1]);
        else ctx.moveTo(el.points[i], el.points[i + 1]);
      }
      ctx.stroke();
    } else if (img?.complete && img.naturalWidth) {
      ctx.drawImage(img, 0, 0, w, h);
    } else if (el.type === 2 || el.fill || el.stroke) {
      ctx.beginPath();
      if (el.cornerRadius && ctx.roundRect) ctx.roundRect(0, 0, w, h, el.cornerRadius);
      else ctx.rect(0, 0, w, h);
      if (el.fill) {
        ctx.fillStyle = el.fill;
        ctx.fill();
      }
      ctx.strokeStyle = el.stroke || "#bbb";
      ctx.lineWidth = el.stroke ? el.strokeWidth || 1 : 1 / s;
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#bbb";
      ctx.lineWidth = 1 / s;
      ctx.strokeRect(0, 0, w, h);
    }
    ctx.restore();
  }

  private drawRoomBase() {
    const cv = this.els.roomBase;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!this.detail) return;
    const s = this.room.scale;
    const bg = this.detail.background ?? {};
    const b = this.roomBounds();
    this.worldTransform(ctx);
    // 房间底色；背景为图片时是户型底图，否则画 1m 网格
    ctx.fillStyle = bg.fill || "#fff";
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.fill();
    const bgImg = this.getImage(bg.src);
    if (bgImg?.complete && bgImg.naturalWidth) {
      ctx.drawImage(bgImg, b.x, b.y, b.w, b.h);
    } else if (!bg.src) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = "rgba(17,20,65,.06)";
      ctx.lineWidth = 1 / s;
      for (let x = 100; x < b.w; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, b.h);
        ctx.stroke();
      }
      for (let y = 100; y < b.h; y += 100) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(b.w, y);
        ctx.stroke();
      }
      ctx.restore();
    }
    const elements = this.detail.elements ?? [];
    // 雷达区域（门、监护床等），坐标在雷达 container 坐标系内
    for (const el of elements) {
      const qc = el.qingLanConfig;
      if (!qc?.container) continue;
      for (const rg of qc.ranges ?? []) {
        const x = qc.container.x + rg.x;
        const y = qc.container.y + rg.y;
        ctx.fillStyle = rg.fill || "rgba(59,79,216,.2)";
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x, y, rg.width, rg.height);
        ctx.globalAlpha = 1;
        if (rg.text) {
          ctx.fillStyle = "rgba(27,29,46,.6)";
          ctx.font = `${12 / s}px sans-serif`;
          ctx.textBaseline = "top";
          ctx.fillText(rg.text, x + 4 / s, y + 4 / s);
        }
      }
    }
    for (const el of elements) this.drawElement(ctx, el, s);
    ctx.lineWidth = bg.strokeWidth || 2;
    ctx.strokeStyle = bg.stroke || "#C9CDDC";
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }

  private drawRoomDyn() {
    const cv = this.els.roomDyn;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!this.data) return;
    const v = this.room;
    const r = window.devicePixelRatio || 1;
    const t = this.t;
    const trailMs = (this.opts().trail || 0) * 1000;
    const toScreen = (x: number, y: number) => [v.ox + x * v.scale, v.oy + y * v.scale] as const;

    for (const tr of this.data.tracks) {
      // 尾迹：沿插值曲线画到当前位置，越旧越淡越细
      if (trailMs > 0 && tr.points.length) {
        const pts = tr.points;
        const t0 = t - trailMs;
        const i0 = Math.max(0, lowerBound(pts, t0, (p) => p.t) - 1);
        const i1 = lowerBound(pts, t + 1, (p) => p.t);
        ctx.setTransform(r, 0, 0, r, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = tr.color;
        for (let i = i0; i < i1; i++) {
          if (!linked(pts[i], pts[i + 1])) continue;
          const ta = Math.max(pts[i].t, t0);
          const tb = Math.min(pts[i + 1].t, t);
          if (tb <= ta) continue;
          const n = clamp(Math.ceil((tb - ta) / 250), 1, 8);
          let [px, py] = toScreen(...interpAt(pts, i, ta));
          for (let k = 1; k <= n; k++) {
            const tk = ta + ((tb - ta) * k) / n;
            const [x, y] = toScreen(...interpAt(pts, i, tk));
            const f = 1 - (t - tk) / trailMs;
            ctx.globalAlpha = 0.1 + 0.8 * f;
            ctx.lineWidth = 1 + 3 * f;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(x, y);
            ctx.stroke();
            px = x;
            py = y;
          }
        }
        ctx.globalAlpha = 1;
      }
      // 当前位置
      const s = trackStateAt(tr, t);
      if (!s || s.x == null || s.y == null) continue;
      const [sx, sy] = toScreen(s.x, s.y);
      const pdef = s.posture != null ? POSTURES[s.posture] : undefined;
      const fill = pdef ? pdef.color : tr.color;
      ctx.setTransform(r, 0, 0, r, 0, 0);
      const alpha = (s.stale ? 0.55 : 1) * s.alpha;
      ctx.globalAlpha = alpha;
      if (pdef?.alarm) {
        const pulse = 14 + 6 * Math.abs(Math.sin(performance.now() / 250));
        ctx.beginPath();
        ctx.arc(sx, sy, pulse, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.globalAlpha = 0.25 * alpha;
        ctx.fill();
        ctx.globalAlpha = alpha;
      }
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = tr.color;
      if (s.stale) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      // 标签
      const label = `${tr.label} ${pdef ? pdef.text : ""}`.trim();
      ctx.font = FONT;
      const w = ctx.measureText(label).width + 12;
      const lx = sx - w / 2;
      const ly = sy - 34;
      ctx.globalAlpha = 0.92 * s.alpha;
      ctx.fillStyle = pdef ? pdef.color : "#5B6078";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(lx, ly, w, 20, 4);
      else ctx.rect(lx, ly, w, 20);
      ctx.fill();
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx + 6, ly + 10);
    }
    ctx.globalAlpha = 1;
  }

  private bindRoom() {
    const stage = this.els.stage;
    this.listen(
      stage,
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = stage.getBoundingClientRect();
        this.zoomRoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false },
    );
    this.listen(stage, "pointerdown", (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add("panning");
      let lx = e.clientX;
      let ly = e.clientY;
      const move = (ev: PointerEvent) => {
        this.room.ox += ev.clientX - lx;
        this.room.oy += ev.clientY - ly;
        lx = ev.clientX;
        ly = ev.clientY;
        this.drawRoomBase();
        this.drawRoomDyn();
      };
      const up = () => {
        stage.classList.remove("panning");
        stage.removeEventListener("pointermove", move);
        stage.removeEventListener("pointerup", up);
      };
      stage.addEventListener("pointermove", move);
      stage.addEventListener("pointerup", up);
    });
  }

  // ---------- 时间轴 ----------

  private tlLayout() {
    const n = this.data ? Math.max(1, this.data.tracks.length) : 1;
    const densTop = TL.AXIS_Y + TL.AXIS_H;
    const lanesTop = densTop + TL.DENS_H + 6;
    const evTop = lanesTop + n * (TL.LANE_H + TL.LANE_GAP);
    return { densTop, lanesTop, evTop, height: evTop + TL.EV_H + 8 };
  }
  private plotW = () => this.els.tlWrap.clientWidth - TL.GUTTER - TL.RIGHT;
  private xOf = (t: number) => TL.GUTTER + ((t - this.v0) / (this.v1 - this.v0)) * this.plotW();
  private tOf = (x: number) => this.v0 + ((x - TL.GUTTER) / this.plotW()) * (this.v1 - this.v0);
  private xOv = (t: number) => TL.GUTTER + ((t - this.q0) / (this.q1 - this.q0)) * this.plotW();
  private tOv = (x: number) => this.q0 + ((x - TL.GUTTER) / this.plotW()) * (this.q1 - this.q0);
  private inView = (t: number) => t >= this.v0 && t <= this.v1;

  private resizeTimeline() {
    const L = this.tlLayout();
    this.els.tlWrap.style.height = L.height + "px";
    this.sizeCanvas(this.els.tlBase, this.els.tlWrap.clientWidth, L.height);
    this.sizeCanvas(this.els.tlOver, this.els.tlWrap.clientWidth, L.height);
    this.drawTimelineBase();
    this.drawTimelineOverlay();
  }

  private clampView() {
    const full = this.q1 - this.q0;
    const span = clamp(this.v1 - this.v0, Math.min(MIN_VIEW_SPAN, full), full);
    if (this.v0 < this.q0) this.v0 = this.q0;
    this.v1 = this.v0 + span;
    if (this.v1 > this.q1) {
      this.v1 = this.q1;
      this.v0 = this.q1 - span;
    }
  }

  setView(v0: number, v1: number) {
    this.v0 = v0;
    this.v1 = v1;
    this.clampView();
    this.drawTimelineBase();
    this.drawTimelineOverlay(this.hover?.x);
    if (this.hover) this.showTip(this.hover.x, this.hover.y);
    else this.els.tip.style.display = "none";
  }

  zoomTimeline(factor: number, anchorT?: number) {
    const anchor = anchorT ?? (this.inView(this.t) ? this.t : (this.v0 + this.v1) / 2);
    const span = (this.v1 - this.v0) * factor;
    const k = (anchor - this.v0) / (this.v1 - this.v0);
    const full = this.q1 - this.q0;
    const s2 = clamp(span, Math.min(MIN_VIEW_SPAN, full), full);
    this.setView(anchor - k * s2, anchor - k * s2 + s2);
  }

  viewAll() {
    this.setView(this.q0, this.q1);
  }

  fitData() {
    const d = this.data;
    if (!d) return;
    let a = Infinity;
    let b = -Infinity;
    if (d.allTs.length) {
      a = d.allTs[0];
      b = d.allTs[d.allTs.length - 1];
    }
    for (const tr of d.tracks)
      if (tr.postures.length) {
        a = Math.min(a, tr.postures[0].s);
        b = Math.max(b, tr.postures[tr.postures.length - 1].e);
      }
    if (d.marks.length) {
      a = Math.min(a, d.marks[0].t);
      b = Math.max(b, d.marks[d.marks.length - 1].t);
    }
    if (!isFinite(a)) return this.setView(this.q0, this.q1);
    const padMs = Math.max(30000, (b - a) * 0.03);
    this.setView(a - padMs, b + padMs);
  }

  private pickStep(span: number, width: number) {
    for (const s of TICK_STEPS) if ((s / span) * width >= 90) return s;
    return TICK_STEPS[TICK_STEPS.length - 1];
  }

  private drawTimelineBase() {
    const cv = this.els.tlBase;
    const ctx = cv.getContext("2d")!;
    const W = this.els.tlWrap.clientWidth;
    const L = this.tlLayout();
    const r = window.devicePixelRatio || 1;
    const pw = this.plotW();
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, W, L.height);
    const spanText = fmtSpan(this.v1 - this.v0);
    if (spanText !== this.lastSpan) {
      this.lastSpan = spanText;
      this.cb.onView(spanText);
    }
    ctx.font = FONT;
    ctx.textBaseline = "middle";
    const d = this.data;

    // 全局导航条
    ctx.fillStyle = C.lane;
    ctx.fillRect(TL.GUTTER, TL.OV_Y, pw, TL.OV_H);
    if (d?.allTs.length) {
      const bins = Math.max(1, Math.floor(pw / 2));
      const binMs = (this.q1 - this.q0) / bins;
      ctx.fillStyle = C.overview;
      for (let i = 0; i < bins; i++) {
        const a = lowerBound(d.allTs, this.q0 + i * binMs);
        const b = lowerBound(d.allTs, this.q0 + (i + 1) * binMs);
        if (b > a) ctx.fillRect(TL.GUTTER + i * 2, TL.OV_Y, 2, TL.OV_H);
      }
      for (const m of d.marks)
        if (m.alarm) {
          ctx.fillStyle = m.color;
          ctx.fillRect(this.xOv(m.t) - 0.5, TL.OV_Y, 1.5, TL.OV_H);
        }
    }
    const vx0 = this.xOv(this.v0);
    const vx1 = Math.max(this.xOv(this.v1), vx0 + 3);
    ctx.fillStyle = "rgba(59,79,216,.12)";
    ctx.fillRect(vx0, TL.OV_Y - 2, vx1 - vx0, TL.OV_H + 4);
    ctx.strokeStyle = C.primary;
    ctx.lineWidth = 1;
    ctx.strokeRect(vx0 + 0.5, TL.OV_Y - 1.5, vx1 - vx0 - 1, TL.OV_H + 3);
    ctx.fillStyle = C.muted;
    ctx.fillText("全局", 8, TL.OV_Y + TL.OV_H / 2);

    // 刻度
    const span = this.v1 - this.v0;
    const step = this.pickStep(span, pw);
    const off = new Date(this.v0).getTimezoneOffset() * 60000;
    let tick = Math.ceil((this.v0 - off) / step) * step + off;
    const axisLine = TL.AXIS_Y + TL.AXIS_H;
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(TL.GUTTER, axisLine + 0.5);
    ctx.lineTo(TL.GUTTER + pw, axisLine + 0.5);
    ctx.stroke();
    let lastDay = "";
    for (; tick <= this.v1; tick += step) {
      const x = Math.round(this.xOf(tick)) + 0.5;
      const dt = new Date(tick);
      ctx.strokeStyle = C.line;
      ctx.beginPath();
      ctx.moveTo(x, axisLine - 5);
      ctx.lineTo(x, axisLine);
      ctx.stroke();
      ctx.strokeStyle = "rgba(17,20,65,.04)";
      ctx.beginPath();
      ctx.moveTo(x, axisLine);
      ctx.lineTo(x, L.evTop + TL.EV_H);
      ctx.stroke();
      ctx.fillStyle = C.text;
      ctx.textAlign = "center";
      ctx.fillText(step < 6e4 ? fmtTime(dt) : fmtTime(dt).slice(0, 5), x, axisLine - 12);
      const day = `${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      if (day !== lastDay) {
        ctx.fillStyle = C.muted;
        ctx.fillText(day, x, axisLine - 25);
        lastDay = day;
      }
    }
    ctx.textAlign = "left";

    // 轨迹点密度
    ctx.fillStyle = C.muted;
    ctx.fillText("轨迹点", 8, L.densTop + TL.DENS_H / 2 + 2);
    if (d?.allTs.length) {
      const bins = Math.max(1, Math.floor(pw / 2));
      const binMs = span / bins;
      const counts = new Array<number>(bins);
      let max = 1;
      for (let i = 0; i < bins; i++) {
        const a = lowerBound(d.allTs, this.v0 + i * binMs);
        const b = lowerBound(d.allTs, this.v0 + (i + 1) * binMs);
        counts[i] = b - a;
        if (counts[i] > max) max = counts[i];
      }
      ctx.fillStyle = C.density;
      for (let i = 0; i < bins; i++) {
        if (!counts[i]) continue;
        const h = Math.max(2, (counts[i] / max) * (TL.DENS_H - 2));
        ctx.fillRect(TL.GUTTER + i * 2, L.densTop + TL.DENS_H - h + 2, 1.6, h);
      }
    }

    // 每个目标一条泳道：灰色 = 有轨迹，彩色 = 姿态
    const tracks = d ? d.tracks : [];
    tracks.forEach((tr, i) => {
      const y = L.lanesTop + i * (TL.LANE_H + TL.LANE_GAP);
      ctx.fillStyle = tr.color;
      ctx.beginPath();
      ctx.arc(12, y + TL.LANE_H / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.text;
      let label = tr.label;
      while (ctx.measureText(label).width > TL.GUTTER - 28 && label.length > 2) label = label.slice(0, -2) + "…";
      ctx.fillText(label, 20, y + TL.LANE_H / 2 + 1);
      ctx.fillStyle = C.lane;
      ctx.fillRect(TL.GUTTER, y, pw, TL.LANE_H);
      ctx.fillStyle = C.run;
      for (const [a, b] of tr.runs) {
        if (b < this.v0 || a > this.v1) continue;
        const x0 = Math.max(TL.GUTTER, this.xOf(a));
        const x1 = Math.min(TL.GUTTER + pw, this.xOf(b));
        ctx.fillRect(x0, y + TL.LANE_H - 4, Math.max(1, x1 - x0), 4);
      }
      for (const seg of tr.postures) {
        if (seg.e < this.v0 || seg.s > this.v1) continue;
        const pdef = POSTURES[seg.p];
        const x0 = Math.max(TL.GUTTER, this.xOf(seg.s));
        const x1 = Math.min(TL.GUTTER + pw, this.xOf(seg.e));
        ctx.fillStyle = pdef ? pdef.color : "#C9CDDC";
        ctx.fillRect(x0, y + (pdef?.alarm ? 0 : 2), Math.max(1, x1 - x0), TL.LANE_H - (pdef?.alarm ? 4 : 6));
      }
    });
    if (!tracks.length) {
      ctx.fillStyle = C.muted;
      ctx.fillText(d ? "这段时间没有轨迹和姿态数据" : "查询后显示", TL.GUTTER + 8, L.lanesTop + TL.LANE_H / 2);
    }

    // 事件
    ctx.fillStyle = C.muted;
    ctx.fillText("事件", 8, L.evTop + TL.EV_H / 2 + 1);
    ctx.fillStyle = C.lane;
    ctx.fillRect(TL.GUTTER, L.evTop, pw, TL.EV_H);
    if (d) {
      for (const ev of d.events) {
        if (ev.t < this.v0 || ev.t > this.v1) continue;
        ctx.fillStyle = EVENTS[ev.type]?.color ?? C.muted;
        ctx.fillRect(this.xOf(ev.t) - 1, L.evTop, 2, TL.EV_H);
      }
    }
  }

  private drawTimelineOverlay(hoverX?: number | null) {
    const cv = this.els.tlOver;
    const ctx = cv.getContext("2d")!;
    const W = this.els.tlWrap.clientWidth;
    const L = this.tlLayout();
    const r = window.devicePixelRatio || 1;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, W, L.height);
    if (hoverX != null) {
      ctx.strokeStyle = "rgba(27,29,46,.35)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverX + 0.5, TL.AXIS_Y + TL.AXIS_H);
      ctx.lineTo(hoverX + 0.5, L.height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 全局导航条上的播放头
    ctx.fillStyle = C.head;
    ctx.fillRect(this.xOv(this.t) - 1, TL.OV_Y - 2, 2, TL.OV_H + 4);
    if (!this.inView(this.t)) return;
    const x = Math.round(this.xOf(this.t)) + 0.5;
    const top = TL.AXIS_Y + TL.AXIS_H;
    ctx.strokeStyle = C.head;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, L.height);
    ctx.stroke();
    ctx.fillStyle = C.head;
    ctx.beginPath();
    ctx.moveTo(x - 6, top - 7);
    ctx.lineTo(x + 6, top - 7);
    ctx.lineTo(x, top);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1;
  }

  private showTip(x: number, y: number) {
    const d = this.data;
    const L = this.tlLayout();
    const tip = this.els.tip;
    if (x < TL.GUTTER || x > TL.GUTTER + this.plotW() || y < TL.AXIS_Y) {
      tip.style.display = "none";
      return;
    }
    const t = this.tOf(x);
    const lines = [`<b>${fmt(t)}</b>`];
    if (d) {
      const laneIdx = Math.floor((y - L.lanesTop) / (TL.LANE_H + TL.LANE_GAP));
      d.tracks.forEach((tr, i) => {
        const p = postureAt(tr, t);
        const pdef = p != null ? POSTURES[p] : undefined;
        if (pdef || i === laneIdx) {
          lines.push(`<i style="background:${tr.color}"></i>${esc(tr.label)}：${pdef ? pdef.text : "—"}`);
        }
      });
      const tol = ((this.v1 - this.v0) / this.plotW()) * 4;
      for (const m of d.marks.filter((m) => Math.abs(m.t - t) <= tol).slice(0, 5)) {
        lines.push(`<i style="background:${m.color}"></i>${fmtTime(new Date(m.t))} ${esc(m.text)}`);
      }
    }
    tip.innerHTML = lines.join("<br>");
    tip.style.display = "block";
    const tw = tip.offsetWidth;
    const W = this.els.tlWrap.clientWidth;
    tip.style.left = clamp(x + 12, 0, W - tw) + "px";
    tip.style.top = Math.max(0, y - tip.offsetHeight - 8) + "px";
  }

  private bindTimeline() {
    const ov = this.els.tlOver;
    // 滚轮缩放（Shift+滚轮平移）、拖动平移、单击定位、导航条拖动、双击放大
    this.listen(
      ov,
      "wheel",
      (e) => {
        e.preventDefault();
        if (!this.data) return;
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          const dv = ((e.deltaX || e.deltaY) / this.plotW()) * (this.v1 - this.v0);
          this.setView(this.v0 + dv, this.v1 + dv);
        } else {
          const delta = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
          const anchor = e.offsetX >= TL.GUTTER ? this.tOf(e.offsetX) : this.t;
          this.zoomTimeline(Math.exp(clamp(delta, -1500, 1500) * 0.002), anchor);
        }
      },
      { passive: false },
    );
    this.listen(ov, "pointerdown", (e) => {
      if (e.button !== 0 || !this.data) return;
      ov.setPointerCapture(e.pointerId);
      const inOverview = e.offsetY <= TL.OV_Y + TL.OV_H + 4;
      const startX = e.offsetX;
      const v0 = this.v0;
      const v1 = this.v1;
      let moved = false;
      if (inOverview) {
        const c = this.tOv(startX);
        this.setView(c - (v1 - v0) / 2, c + (v1 - v0) / 2);
      }
      const move = (ev: PointerEvent) => {
        const dx = ev.offsetX - startX;
        if (Math.abs(dx) > 3) moved = true;
        if (inOverview) {
          const c = this.tOv(ev.offsetX);
          this.setView(c - (v1 - v0) / 2, c + (v1 - v0) / 2);
        } else if (moved) {
          const dv = (-dx / this.plotW()) * (v1 - v0);
          this.setView(v0 + dv, v1 + dv);
        }
      };
      const up = (ev: PointerEvent) => {
        ov.removeEventListener("pointermove", move);
        ov.removeEventListener("pointerup", up);
        if (!inOverview && !moved && ev.offsetX >= TL.GUTTER) this.seek(this.tOf(ev.offsetX));
      };
      ov.addEventListener("pointermove", move);
      ov.addEventListener("pointerup", up);
    });
    this.listen(ov, "dblclick", (e) => {
      if (this.data && e.offsetX >= TL.GUTTER) this.zoomTimeline(0.5, this.tOf(e.offsetX));
    });
    this.listen(ov, "mousemove", (e) => {
      this.hover = { x: e.offsetX, y: e.offsetY };
      this.drawTimelineOverlay(e.offsetX >= TL.GUTTER && e.offsetY > TL.AXIS_Y ? e.offsetX : null);
      this.showTip(e.offsetX, e.offsetY);
    });
    this.listen(ov, "mouseleave", () => {
      this.hover = null;
      this.els.tip.style.display = "none";
      this.drawTimelineOverlay();
    });
  }

  // ---------- 播放 ----------

  seek(t: number, fromPlayback = false) {
    this.t = clamp(t, this.q0, this.q1);
    if (this.opts().follow && !this.inView(this.t)) {
      const span = this.v1 - this.v0;
      const v0 = fromPlayback ? this.t - span * 0.1 : this.t - span / 2;
      this.setView(v0, v0 + span);
    } else {
      this.drawTimelineOverlay(this.hover?.x);
    }
    this.renderFrame(!this.playing);
  }

  private renderFrame(force = false) {
    this.drawRoomDyn();
    const now = performance.now();
    if (force || now - this.lastNotify > 150) {
      this.lastNotify = now;
      this.cb.onTime(this.t);
    }
  }

  play() {
    if (!this.data) return;
    if (this.t >= this.q1) this.t = this.q0;
    this.playing = true;
    this.cb.onPlaying(true);
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.cb.onPlaying(false);
    this.renderFrame(true);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  private tick = (nowMs: number) => {
    if (!this.playing || !this.data) return;
    const dt = Math.min(200, nowMs - this.lastFrame);
    this.lastFrame = nowMs;
    const o = this.opts();
    let t = this.t + dt * (o.speed || 1);
    const d = this.data;
    // 跳过无人时段：画面上一个目标都没有、下一个点还在 3 秒以后，就直接跳到它前面
    if (o.skip && d.allTs.length && !d.tracks.some((tr) => trackStateAt(tr, t))) {
      const next = d.allTs[lowerBound(d.allTs, t)] ?? Infinity;
      if (next - t > 3000) {
        const nextMark = d.marks[lowerBound(d.marks, t, (m) => m.t)];
        const target = Math.min(next, nextMark ? nextMark.t : Infinity);
        if (isFinite(target)) t = Math.max(t, target - 500);
      }
    }
    if (t >= this.q1) {
      this.seek(this.q1, true);
      this.pause();
      return;
    }
    this.seek(t, true);
    this.raf = requestAnimationFrame(this.tick);
  };

  /** 跳到上一个 / 下一个事件或告警（提前 2 秒）；刚跳到的那个事件在 t + 2 秒处，找下一个要越过它 */
  jumpMark(dir: 1 | -1) {
    const marks = this.data?.marks ?? [];
    if (!marks.length) return;
    const at = this.t + 2000;
    const m = dir > 0 ? marks[lowerBound(marks, at + 100, (x) => x.t)] : marks[lowerBound(marks, at - 100, (x) => x.t) - 1];
    if (m) this.seek(m.t - 2000);
  }

  /** 定位到某个事件：不在视图内时先把视图移过去 */
  gotoMark(t: number) {
    const span = this.v1 - this.v0;
    if (!this.inView(t)) this.setView(t - span / 2, t + span / 2);
    this.seek(t - 2000);
  }

  toStart() {
    const d = this.data;
    this.seek(d?.allTs.length ? Math.max(this.q0, d.allTs[0] - 1000) : this.q0);
  }

  step(ms: number) {
    this.seek(this.t + ms);
  }
}
