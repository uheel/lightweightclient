// ==UserScript==
// @name         雷达平台 - 安装角度检查
// @namespace    goodlife-ops
// @version      0.2.2
// @description  在「房间详情」页增加"安装角度"按钮：根据设备心跳上报的 [angle_x, angle_y, angle_z] 实时判断安装角度是否在标准范围内
// @match        https://rd.igoodlife.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const ROUTE = '/care/monitoring/room-view';
  const POLL_MS = 5000;
  const STALE_MS = 3 * 60 * 1000;
  const SETTINGS_KEY = 'gia:settings';

  // 安装标准（installType：0 = 顶装，1 = 侧装）。angle_* 为加速度计各轴与水平面的夹角
  const STANDARDS = {
    0: { name: '顶装', tol: 3, axes: { x: 0, y: 0, z: 90 } },
    // 侧装只绕 x 轴下倾，angle_y + angle_z = 90°；angle_y 标准 68°，俯角 = 90° - angle_y = 22°
    1: { name: '侧装', tol: 2, axes: { x: 0, y: 68, z: 22 } },
  };
  const AXES = ['x', 'y', 'z'];
  const WINDOWS = [[30 * 60e3, '30 分钟'], [2 * 36e5, '2 小时'], [6 * 36e5, '6 小时'], [24 * 36e5, '24 小时']];
  const COLORS = { ok: '#52c41a', warn: '#faad14', bad: '#ff4d4f', none: '#bfbfbf' };

  // ---------- 工具函数 ----------

  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const fmt = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${fmtTime(d)}`; };
  const parseTime = (s) => new Date(String(s).replace(' ', 'T')).getTime();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const deg = (v, n = 1) => (v == null || !isFinite(v) ? '--' : `${v.toFixed(n)}°`);
  const signed = (v, n = 1) => (v == null || !isFinite(v) ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(n)}°`);

  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* 忽略 */ }
  }
  function fmtAgo(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} 秒前`;
    if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    return `${Math.floor(s / 86400)} 天前`;
  }

  // ---------- 接口 ----------

  async function api(path, params) {
    const qs = params
      ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
      : '';
    const res = await fetch(path + qs, {
      headers: {
        authorization: 'Bearer ' + sessionStorage.getItem('SDB_TOKEN'),
        orgid: sessionStorage.getItem('SDB_ORG_ID') || '',
        orgtype: sessionStorage.getItem('SDB_ORG_TYPE') || '',
        locale: localStorage.getItem('umi_locale') || 'zh-CN',
      },
    });
    if (res.status === 401) throw new Error('登录已失效，请刷新页面重新登录');
    const json = await res.json();
    if (!json.succeeded) throw new Error(json.message || `${path} 请求失败`);
    return json.data;
  }

  // 心跳日志里每次心跳有两条记录，只有设备上报的那条带 install
  function parseHeartbeat(row) {
    try {
      const p = JSON.parse(row.rawData).params;
      if (p && Array.isArray(p.install) && p.install.length >= 3) {
        return { t: parseTime(row.createdAt), x: +p.install[0], y: +p.install[1], z: +p.install[2], rssi: p.rssi, fw: p.firmware_ver };
      }
    } catch (e) { /* 非 JSON 或缺字段 */ }
    return null;
  }

  async function fetchHeartbeats(sn, sinceMs) {
    const params = { pageSize: 8, current: 1, 'filter[sn]': sn, 'filter[command]': 'Device.heartbeat' };
    if (sinceMs) {
      params.pageSize = Math.min(3200, Math.ceil((Date.now() - sinceMs) / 60e3) * 2 + 20);
      params['filter[createdAt]'] = `${fmt(sinceMs)},${fmt(Date.now() + 60e3)}`;
    }
    const rows = await api('/api/device-log/pages', params);
    return (rows || []).map(parseHeartbeat).filter(Boolean).sort((a, b) => a.t - b.t);
  }

  function evaluate(sample, type) {
    const std = STANDARDS[type];
    const axes = {};
    let overall = 'ok';
    for (const k of AXES) {
      const dev = sample[k] - std.axes[k];
      const a = Math.abs(dev);
      const status = a > std.tol ? 'bad' : a > std.tol * 0.75 ? 'warn' : 'ok';
      axes[k] = { value: sample[k], std: std.axes[k], dev, status };
      if (status === 'bad') overall = 'bad';
      else if (status === 'warn' && overall === 'ok') overall = 'warn';
    }
    return { overall, axes, tol: std.tol };
  }

  // 当前显示的房间：优先读页面组件的 roomId，再看 URL 和最近的房间详情请求
  function resolveRoomId(fromEl) {
    const isId = (v) => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
    const key = fromEl && Object.keys(fromEl).find((k) => k.startsWith('__reactFiber'));
    let f = key && fromEl[key];
    for (let n = 0; f && n < 200; n++, f = f.return) {
      const p = f.memoizedProps;
      if (p && isId(p.roomId)) return p.roomId;
    }
    const fromUrl = new URLSearchParams(location.search).get('roomId');
    if (isId(fromUrl)) return fromUrl;
    const reqs = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/api/room-view/v3/detail?'));
    const last = reqs.length && new URL(reqs[reqs.length - 1]).searchParams.get('roomId');
    return isId(last) ? last : null;
  }

  // ---------- 样式 ----------

  const CSS = `
.gia-mask{position:fixed;inset:0;z-index:1050;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1.5715;color:rgba(0,0,0,.88);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans','PingFang SC','Microsoft YaHei',sans-serif}
.gia-modal{width:min(1040px,96vw);max-height:94vh;background:#fff;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.08),0 3px 6px -4px rgba(0,0,0,.12),0 9px 28px 8px rgba(0,0,0,.05);display:flex;flex-direction:column;overflow:hidden}
.gia-modal *{box-sizing:border-box}
.gia-header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0}
.gia-title{font-size:16px;font-weight:600}
.gia-title small{font-weight:400;color:rgba(0,0,0,.45);font-size:13px;margin-left:8px}
.gia-close{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:rgba(0,0,0,.45);font-size:20px}
.gia-close:hover{background:rgba(0,0,0,.06);color:rgba(0,0,0,.88)}
.gia-body{padding:14px 20px 18px;overflow:auto}
.gia-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin-bottom:12px}
.gia-bar .lbl{color:rgba(0,0,0,.65)}
.gia-seg{display:inline-flex;padding:2px;background:rgba(0,0,0,.04);border-radius:6px;gap:2px;flex-wrap:wrap}
.gia-seg button{border:0;background:transparent;height:28px;padding:0 11px;border-radius:4px;font-size:14px;color:rgba(0,0,0,.65);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.gia-seg button:hover{color:rgba(0,0,0,.88)}
.gia-seg button.active{background:#fff;color:rgba(0,0,0,.88);box-shadow:0 1px 2px rgba(0,0,0,.03),0 1px 6px -1px rgba(0,0,0,.02),0 2px 4px rgba(0,0,0,.02)}
.gia-dot{display:inline-block;width:6px;height:6px;border-radius:50%}
.gia-note{color:rgba(0,0,0,.45);font-size:12px}
.gia-main{display:grid;grid-template-columns:1fr 300px;gap:16px}
.gia-verdict{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:8px;border:1px solid}
.gia-verdict .icon{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:700;flex:none}
.gia-verdict .t1{font-size:18px;font-weight:600}
.gia-verdict .t2{font-size:13px;color:rgba(0,0,0,.65)}
.gia-verdict.ok{background:#f6ffed;border-color:#b7eb8f}.gia-verdict.ok .icon{background:#52c41a}
.gia-verdict.warn{background:#fffbe6;border-color:#ffe58f}.gia-verdict.warn .icon{background:#faad14}
.gia-verdict.bad{background:#fff2f0;border-color:#ffccc7}.gia-verdict.bad .icon{background:#ff4d4f}
.gia-verdict.none{background:#fafafa;border-color:#f0f0f0}.gia-verdict.none .icon{background:#bfbfbf}
.gia-table{width:100%;border-collapse:collapse;margin-top:12px;font-variant-numeric:tabular-nums}
.gia-table th{background:#fafafa;font-weight:600;text-align:left;padding:8px;border-bottom:1px solid #f0f0f0;font-size:13px}
.gia-table td{padding:8px;border-bottom:1px solid #f0f0f0}
.gia-table td.v{font-size:16px;font-weight:600}
.gia-tag{display:inline-block;padding:0 7px;border-radius:4px;font-size:12px;line-height:20px;border:1px solid}
.gia-tag.ok{color:#389e0d;background:#f6ffed;border-color:#b7eb8f}
.gia-tag.warn{color:#d48806;background:#fffbe6;border-color:#ffe58f}
.gia-tag.bad{color:#cf1322;background:#fff2f0;border-color:#ffccc7}
.gia-meta{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px;font-size:12px;color:rgba(0,0,0,.45)}
.gia-meta b{color:rgba(0,0,0,.88);font-weight:500}
.gia-live{display:inline-flex;align-items:center;gap:6px}
.gia-live .gia-dot{background:#52c41a;animation:gia-pulse 1.5s infinite}
@keyframes gia-pulse{0%{box-shadow:0 0 0 0 rgba(82,196,26,.6)}70%{box-shadow:0 0 0 6px rgba(82,196,26,0)}100%{box-shadow:0 0 0 0 rgba(82,196,26,0)}}
.gia-visual{display:flex;flex-direction:column;gap:10px}
.gia-card{border:1px solid #f0f0f0;border-radius:8px;padding:8px 10px}
.gia-card h4{margin:0 0 4px;font-size:13px;font-weight:600}
.gia-card svg{display:block;width:100%;height:auto}
.gia-trend{margin-top:16px;border-top:1px solid #f0f0f0;padding-top:12px}
.gia-trend-head{display:flex;align-items:center;gap:12px;margin-bottom:6px}
.gia-trend-head .t{font-weight:600}
.gia-trend-wrap{position:relative}
.gia-trend svg{display:block;width:100%;height:auto}
.gia-tip{position:absolute;pointer-events:none;background:rgba(0,0,0,.78);color:#fff;font-size:12px;line-height:1.6;padding:6px 8px;border-radius:6px;white-space:nowrap;display:none;font-variant-numeric:tabular-nums}
.gia-empty{padding:40px 0;text-align:center;color:rgba(0,0,0,.45)}
.gia-left{display:flex;flex-direction:column;min-width:0}
.gia-3d{margin-top:12px;border-radius:8px;overflow:hidden;background:#141e2c;position:relative;user-select:none;flex:1;min-height:380px;display:flex;flex-direction:column}
.gia-3d-stage{position:relative;flex:1;min-height:380px;cursor:grab}
.gia-3d-stage.dragging{cursor:grabbing}
.gia-3d-stage canvas{position:absolute;left:0;top:0}
.gia-3d-title{position:absolute;left:16px;top:12px;color:#fff;font-size:16px;font-weight:600;pointer-events:none}
.gia-3d-hint{position:absolute;right:16px;top:14px;color:rgba(255,255,255,.55);font-size:12px;pointer-events:none}
.gia-3d-hud{position:absolute;left:16px;top:44px;color:rgba(255,255,255,.85);font-size:12px;line-height:1.9;font-variant-numeric:tabular-nums;pointer-events:none}
.gia-3d-hud i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.gia-3d-tools{position:absolute;right:12px;bottom:12px;display:flex;gap:4px}
.gia-3d-tools button{height:24px;padding:0 8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:rgba(255,255,255,.8);border-radius:4px;font-size:12px;cursor:pointer}
.gia-3d-tools button:hover{border-color:#4096ff;color:#fff}
.gia-3d-opts{position:absolute;left:16px;bottom:12px;display:flex;gap:14px;color:rgba(255,255,255,.75);font-size:12px}
.gia-3d-opts label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.gia-3d-opts input{margin:0;accent-color:#1677ff}
.gia-entry{position:relative}
.gia-entry::after{content:'';position:absolute;right:-1px;top:-1px;width:6px;height:6px;border-radius:50%;background:#556ff7}
`;

  const RULER_SVG = '<svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor"><path d="M128 640 640 128l256 256-512 512zM226 640l158 158 414-414-158-158-62 62 79 79-45 45-79-79-62 62 79 79-45 45-79-79-62 62 79 79-45 45-79-79z"/></svg>';

  function ensureStyle() {
    if (document.getElementById('gia-style')) return;
    const style = document.createElement('style');
    style.id = 'gia-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ---------- 图形 ----------

  // 水平仪：两个轴相对标准值的偏差，圆圈为允许范围
  function bubbleSvg(ev, type) {
    const [ka, kb] = type === 0 ? ['x', 'y'] : ['x', 'z'];
    const tol = ev ? ev.tol : STANDARDS[type].tol;
    const R = 80, range = tol * 2.5, sc = R / range;
    const cx = 100, cy = 95;
    let bubble = '';
    if (ev) {
      const dx = ev.axes[ka].dev, dy = ev.axes[kb].dev;
      const st = ev.axes[ka].status === 'bad' || ev.axes[kb].status === 'bad' ? 'bad'
        : ev.axes[ka].status === 'warn' || ev.axes[kb].status === 'warn' ? 'warn' : 'ok';
      const px = cx + clamp(dx, -range, range) * sc, py = cy - clamp(dy, -range, range) * sc;
      bubble = `<circle cx="${px}" cy="${py}" r="9" fill="${COLORS[st]}" fill-opacity=".85" stroke="#fff" stroke-width="2"/>`;
    }
    return `<svg viewBox="0 0 200 195">
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="#fafafa" stroke="#d9d9d9"/>
      <circle cx="${cx}" cy="${cy}" r="${tol * sc}" fill="rgba(82,196,26,.12)" stroke="#52c41a" stroke-dasharray="4 3"/>
      <line x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}" stroke="#e8e8e8"/>
      <line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}" stroke="#e8e8e8"/>
      <text x="${cx + R - 2}" y="${cy - 4}" font-size="11" text-anchor="end" fill="rgba(0,0,0,.45)">${ka} +</text>
      <text x="${cx + 4}" y="${cy - R + 12}" font-size="11" fill="rgba(0,0,0,.45)">${kb} +</text>
      <text x="${cx + tol * sc + 3}" y="${cy + 12}" font-size="10" fill="#52c41a">±${tol}°</text>
      ${bubble}
      <text x="${cx}" y="190" font-size="11" text-anchor="middle" fill="rgba(0,0,0,.45)">外圈 ±${range.toFixed(1)}°</text>
    </svg>`;
  }

  // 侧视图：侧装看俯角（90° - y），顶装看 z 轴与水平面夹角
  function pitchSvg(ev, type) {
    const std = STANDARDS[type];
    const side = type === 1;
    const stdA = side ? 90 - std.axes.y : std.axes.z;
    const cur = ev ? (side ? 90 - ev.axes.y.value : ev.axes.z.value) : null;
    const status = ev ? (side ? ev.axes.y.status : ev.axes.z.status) : 'none';
    const ox = side ? 30 : 100, oy = side ? 30 : 36, L = side ? 150 : 115;
    const ray = (a) => [ox + L * Math.cos(a * Math.PI / 180), oy + L * Math.sin(a * Math.PI / 180)];
    const arc = (a0, a1) => {
      const [x0, y0] = ray(a0), [x1, y1] = ray(a1);
      return `M${ox},${oy} L${x0},${y0} A${L},${L} 0 0 1 ${x1},${y1} Z`;
    };
    const [sx, sy] = ray(stdA);
    const mount = side
      ? `<rect x="${ox - 14}" y="0" width="8" height="160" fill="#d9d9d9"/><text x="${ox - 10}" y="172" font-size="10" text-anchor="middle" fill="rgba(0,0,0,.45)">墙</text>`
      : `<rect x="0" y="${oy - 16}" width="200" height="8" fill="#d9d9d9"/><text x="6" y="${oy - 20}" font-size="10" fill="rgba(0,0,0,.45)">天花板</text>`;
    let curRay = '';
    if (cur != null) {
      const [cx, cy] = ray(clamp(cur, -10, 190));
      curRay = `<line x1="${ox}" y1="${oy}" x2="${cx}" y2="${cy}" stroke="${COLORS[status]}" stroke-width="3" stroke-linecap="round"/>`;
    }
    const label = side ? '俯角' : 'z 轴';
    return `<svg viewBox="0 0 200 ${side ? 180 : 165}">
      ${mount}
      <line x1="${ox}" y1="${oy}" x2="${ox + (side ? 160 : 90)}" y2="${oy}" stroke="#e8e8e8" stroke-dasharray="3 3"/>
      <path d="${arc(stdA - std.tol, stdA + std.tol)}" fill="rgba(82,196,26,.15)"/>
      <line x1="${ox}" y1="${oy}" x2="${sx}" y2="${sy}" stroke="#52c41a" stroke-dasharray="5 4"/>
      ${curRay}
      <rect x="${ox - 7}" y="${oy - 5}" width="14" height="10" rx="2" fill="#556ff7"/>
      <text x="196" y="${side ? 170 : 158}" font-size="12" text-anchor="end" fill="rgba(0,0,0,.88)">${label} ${cur == null ? '--' : cur.toFixed(1) + '°'}</text>
      <text x="196" y="${side ? 154 : 142}" font-size="11" text-anchor="end" fill="#52c41a">标准 ${stdA}° ±${std.tol}°</text>
    </svg>`;
  }

  // ---------- 3D 空间姿态 ----------

  const AXIS_COLORS = { x: '#ff8a8a', y: '#7ee2a8', z: '#8fb4ff' };
  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  };

  // 由三个轴与水平面的夹角还原设备姿态，返回设备 x/y/z 轴在世界坐标（东、北、上）中的方向。
  // 加速度计只能确定倾斜，不能确定绕竖直轴的朝向，这里固定让设备 x 轴的水平投影朝东。
  function attitudeFromAngles(ax, ay, az) {
    const r = Math.PI / 180;
    const up = v3.norm([Math.sin(ax * r), Math.sin(ay * r), Math.sin(az * r)]); // 竖直向上在设备坐标系中的方向
    const ref = Math.abs(up[0]) < 0.95 ? [1, 0, 0] : [0, 1, 0];
    const h1 = v3.norm(v3.add(ref, v3.scale(up, -v3.dot(ref, up))));
    const h2 = v3.cross(up, h1);
    return { x: [h1[0], h2[0], up[0]], y: [h1[1], h2[1], up[1]], z: [h1[2], h2[2], up[2]] };
  }

  function createAttitudeView(host) {
    host.innerHTML = `
<div class="gia-3d-stage"><canvas></canvas></div>
<div class="gia-3d-title">空间姿态</div>
<div class="gia-3d-hint">拖动旋转视角 · 滚轮缩放 · 双击复位</div>
<div class="gia-3d-hud"></div>
<div class="gia-3d-opts">
  <label><input type="checkbox" data-o="angles" checked>角度标注</label>
  <label><input type="checkbox" data-o="std" checked>标准姿态（虚线）</label>
</div>
<div class="gia-3d-tools">
  <button data-v="default">默认</button><button data-v="front">正视</button><button data-v="side">侧视（沿 x 轴）</button><button data-v="top">俯视</button>
</div>`;
    const stage = host.querySelector('.gia-3d-stage');
    const cv = host.querySelector('canvas');
    const hud = host.querySelector('.gia-3d-hud');
    const PRESETS = { default: [-0.75, 0.32, 1], front: [0, 0, 1], side: [Math.PI / 2, 0, 1], top: [-0.75, 1.5, 1] };
    const view = { yaw: PRESETS.default[0], pitch: PRESETS.default[1], zoom: 1 };
    const opts = { angles: true, std: true };
    let data = null, W = 0, H = 0, raf = 0;

    function resize() {
      const r = window.devicePixelRatio || 1;
      W = stage.clientWidth; H = stage.clientHeight;
      cv.width = Math.max(1, Math.round(W * r)); cv.height = Math.max(1, Math.round(H * r));
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      draw();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(stage);

    // 相机绕原点旋转：yaw 绕竖直轴，pitch 为仰视角；带轻微透视
    function proj(p) {
      const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
      const x1 = p[0] * cy - p[1] * sy, y1 = p[0] * sy + p[1] * cy, z1 = p[2];
      const depth = y1 * cp - z1 * sp, up = y1 * sp + z1 * cp;
      const s = Math.min(W, H) * 0.3 * view.zoom * (6 / (6 + depth));
      return [W / 2 + x1 * s, H * 0.6 - up * s, depth];
    }

    function line(ctx, a, b, color, width, dash) {
      const p = proj(a), q = proj(b);
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      ctx.setLineDash([]);
    }
    function label(ctx, p3, text, color, border) {
      const [x, y] = proj(p3);
      ctx.font = '12px sans-serif';
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = 'rgba(10,16,26,.78)';
      ctx.strokeStyle = border || 'transparent';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 10, w, 20, 4); else ctx.rect(x - w / 2, y - 10, w, 20);
      ctx.fill(); if (border) ctx.stroke();
      ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(text, x, y + 1);
      ctx.textAlign = 'left';
    }

    function draw() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(render);
    }

    function render() {
      const ctx = cv.getContext('2d');
      const r = window.devicePixelRatio || 1;
      ctx.setTransform(r, 0, 0, r, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const FLOOR = -0.95, PS = 1.5;

      // 水平参考面与网格
      const corners = [[-PS, -PS, FLOOR], [PS, -PS, FLOOR], [PS, PS, FLOOR], [-PS, PS, FLOOR]].map(proj);
      ctx.fillStyle = 'rgba(90,110,140,.22)';
      ctx.beginPath(); corners.forEach((c, i) => (i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1]))); ctx.closePath(); ctx.fill();
      for (let g = -PS; g <= PS + 1e-6; g += PS / 4) {
        line(ctx, [g, -PS, FLOOR], [g, PS, FLOOR], 'rgba(255,255,255,.06)', 1);
        line(ctx, [-PS, g, FLOOR], [PS, g, FLOOR], 'rgba(255,255,255,.06)', 1);
      }
      label(ctx, [PS, -PS, FLOOR], '水平参考面', 'rgba(255,255,255,.6)');
      // 竖直参考线
      line(ctx, [0, 0, FLOOR], [0, 0, 1.55], 'rgba(255,255,255,.55)', 1.5, [5, 5]);
      label(ctx, [0, 0, 1.65], '竖直向上', 'rgba(255,255,255,.75)');

      if (!data) {
        ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('暂无角度数据', W / 2, H / 2); ctx.textAlign = 'left';
        return;
      }
      const { att, stdAtt, ev, sample } = data;

      // 设备盒子：x 宽、y 长、z 薄，半透明面按深度从远到近绘制
      const half = { x: 0.38, y: 0.72, z: 0.16 };
      const P = (sx, sy, sz) => v3.add(v3.add(v3.scale(att.x, sx * half.x), v3.scale(att.y, sy * half.y)), v3.scale(att.z, sz * half.z));
      const faces = [
        [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1], att.x],
        [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], v3.scale(att.x, -1)],
        [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1], att.y],
        [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], v3.scale(att.y, -1)],
        [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], att.z],
        [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1], v3.scale(att.z, -1)],
      ].map((f) => {
        const pts = f.slice(0, 4).map((c) => proj(P(c[0], c[1], c[2])));
        return { pts, n: f[4], depth: pts.reduce((s, p) => s + p[2], 0) / 4 };
      }).sort((a, b) => b.depth - a.depth);
      const light = v3.norm([0.35, -0.5, 0.8]);
      for (const f of faces) {
        const b = 0.6 + 0.4 * Math.max(0, v3.dot(f.n, light));
        ctx.fillStyle = `rgba(${Math.round(42 * b)},${Math.round(64 * b)},${Math.round(96 * b)},.72)`;
        ctx.strokeStyle = 'rgba(160,180,210,.75)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); f.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      const c0 = proj([0, 0, 0]);
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('RADAR', c0[0], c0[1] + 18); ctx.textAlign = 'left';

      const LEN = 1.35;
      // 标准姿态（虚线）
      if (opts.std && stdAtt) {
        for (const k of AXES) {
          line(ctx, [0, 0, 0], v3.scale(stdAtt[k], LEN), AXIS_COLORS[k] + '88', 1.5, [6, 5]);
          label(ctx, v3.scale(stdAtt[k], LEN + 0.3), `标准 ${k.toUpperCase()}`, AXIS_COLORS[k] + 'aa');
        }
      }

      // 角度标注：轴到水平面的投影（虚线）+ 夹角弧线 + 数值
      if (opts.angles) {
        const radius = { x: 0.55, y: 0.75, z: 0.95 };
        for (const k of AXES) {
          const a = att[k];
          const hl = Math.hypot(a[0], a[1]);
          if (hl < 0.02) { // 接近竖直，投影方向不确定，直接标在轴旁边
            label(ctx, v3.add(v3.scale(a, 0.85), [0.28, 0, 0]), `${k} ${deg(sample[k])}`, AXIS_COLORS[k], COLORS[ev.axes[k].status]);
            continue;
          }
          const h = [a[0] / hl, a[1] / hl, 0];
          const alpha = Math.asin(clamp(a[2], -1, 1));
          const R = radius[k];
          line(ctx, [0, 0, 0], v3.scale(h, R + 0.2), AXIS_COLORS[k] + '66', 1, [3, 4]);
          ctx.strokeStyle = AXIS_COLORS[k]; ctx.lineWidth = 1.5; ctx.beginPath();
          for (let i = 0; i <= 24; i++) {
            const b = alpha * i / 24;
            const p = proj(v3.add(v3.scale(h, R * Math.cos(b)), [0, 0, R * Math.sin(b)]));
            i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
          }
          ctx.stroke();
          const mid = v3.add(v3.scale(h, (R + 0.08) * Math.cos(alpha / 2)), [0, 0, (R + 0.08) * Math.sin(alpha / 2)]);
          label(ctx, mid, `${k} ${deg(sample[k])}`, AXIS_COLORS[k], COLORS[ev.axes[k].status]);
        }
      }

      // 实际坐标轴
      for (const k of AXES) {
        const end = v3.scale(att[k], LEN);
        line(ctx, [0, 0, 0], end, AXIS_COLORS[k], 2.5);
        const p = proj(end);
        ctx.fillStyle = AXIS_COLORS[k]; ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.fill();
        ctx.font = '14px sans-serif'; ctx.fillText(`+${k.toUpperCase()}`, p[0] + 9, p[1] - 6);
      }
    }

    // 交互
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('dragging');
      let lx = e.clientX, ly = e.clientY;
      const move = (ev) => {
        view.yaw += (ev.clientX - lx) * 0.008; // 向右拖，设备朝向向右转（跟手）
        view.pitch = clamp(view.pitch + (ev.clientY - ly) * 0.008, -0.6, 1.55);
        lx = ev.clientX; ly = ev.clientY;
        draw();
      };
      const up = () => {
        stage.classList.remove('dragging');
        stage.removeEventListener('pointermove', move);
        stage.removeEventListener('pointerup', up);
      };
      stage.addEventListener('pointermove', move);
      stage.addEventListener('pointerup', up);
    });
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0015), 0.4, 3);
      draw();
    }, { passive: false });
    const setPreset = (name) => { [view.yaw, view.pitch, view.zoom] = PRESETS[name]; draw(); };
    stage.addEventListener('dblclick', () => setPreset('default'));
    host.querySelector('.gia-3d-tools').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (b) setPreset(b.dataset.v);
    });
    host.querySelector('.gia-3d-opts').addEventListener('change', (e) => {
      if (e.target.dataset.o) { opts[e.target.dataset.o] = e.target.checked; draw(); }
    });

    return {
      update(sample, type, ev) {
        const std = STANDARDS[type];
        data = sample ? {
          sample, ev,
          att: attitudeFromAngles(sample.x, sample.y, sample.z),
          stdAtt: attitudeFromAngles(std.axes.x, std.axes.y, std.axes.z),
        } : null;
        hud.innerHTML = sample
          ? AXES.map((k) => `<div><i style="background:${AXIS_COLORS[k]}"></i>angle_${k} <b style="color:${COLORS[ev.axes[k].status]}">${deg(sample[k], 2)}</b> <span style="color:rgba(255,255,255,.5)">标准 ${std.axes[k]}° ±${std.tol}°</span></div>`).join('')
          : '';
        draw();
      },
      destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
    };
  }

  // ---------- 弹窗 ----------

  async function openAngleCheck(roomId) {
    ensureStyle();
    const settings = Object.assign({ windowIdx: 1 }, loadSettings());
    const st = {
      detail: null, devices: [], sn: null, typeOverride: {},
      history: [], loadingHistory: false, timer: 0, tickTimer: 0, error: '',
    };

    const root = document.createElement('div');
    root.className = 'gia-mask';
    root.innerHTML = `
<div class="gia-modal" role="dialog">
  <div class="gia-header">
    <span class="gia-title">安装角度检查<small class="gia-room">加载房间…</small></span>
    <span class="gia-close" title="关闭 (Esc)">×</span>
  </div>
  <div class="gia-body"><div class="gia-empty">加载中…</div></div>
</div>`;
    document.body.appendChild(root);
    const body = root.querySelector('.gia-body');

    function close() {
      clearInterval(st.timer);
      clearInterval(st.tickTimer);
      if (st.view3d) st.view3d.destroy();
      document.removeEventListener('keydown', onKey, true);
      root.remove();
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);
    root.querySelector('.gia-close').addEventListener('click', close);
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });

    try {
      st.detail = await api('/api/room-view/v3/detail', { roomId });
    } catch (e) {
      body.innerHTML = `<div class="gia-empty">加载房间失败：${esc(e.message)}</div>`;
      return;
    }
    const det = st.detail;
    root.querySelector('.gia-room').textContent = [det.buildingName, det.floorName, det.roomName].filter(Boolean).join(' / ');
    const cfgBySn = {};
    for (const el of det.elements || []) if (el.sn && el.qingLanConfig) cfgBySn[el.sn] = el.qingLanConfig;
    st.devices = (det.devices || []).filter((d) => d.sn).map((d) => ({
      sn: d.sn, name: d.deviceName || d.sn, online: d.isOnline,
      installType: cfgBySn[d.sn] && (cfgBySn[d.sn].installType === 0 || cfgBySn[d.sn].installType === 1) ? cfgBySn[d.sn].installType : null,
    }));
    if (!st.devices.length) {
      body.innerHTML = '<div class="gia-empty">该房间没有绑定设备</div>';
      return;
    }
    st.sn = (st.devices.find((d) => d.online) || st.devices[0]).sn;

    body.innerHTML = `
<div class="gia-bar">
  <span class="lbl">设备</span><span class="gia-seg gia-devs"></span>
  <span class="lbl">安装方式</span><span class="gia-seg gia-types"></span>
  <span class="gia-note gia-type-note"></span>
</div>
<div class="gia-main">
  <div class="gia-left">
    <div class="gia-verdict none"></div>
    <table class="gia-table">
      <thead><tr><th>轴</th><th>当前值</th><th>标准</th><th>允许范围</th><th>偏差</th><th>状态</th></tr></thead>
      <tbody></tbody>
    </table>
    <div class="gia-meta"></div>
    <div class="gia-3d"></div>
  </div>
  <div class="gia-visual">
    <div class="gia-card"><h4 class="gia-pitch-title"></h4><div class="gia-pitch"></div></div>
    <div class="gia-card"><h4 class="gia-bubble-title"></h4><div class="gia-bubble"></div></div>
  </div>
</div>
<div class="gia-trend">
  <div class="gia-trend-head"><span class="t">角度趋势</span><span class="gia-seg gia-wins"></span><span class="gia-note gia-trend-note"></span></div>
  <div class="gia-trend-wrap"><div class="gia-trend-svg"></div><div class="gia-tip"></div></div>
</div>`;
    const $ = (s) => body.querySelector(s);
    st.view3d = createAttitudeView($('.gia-3d'));

    const currentDevice = () => st.devices.find((d) => d.sn === st.sn);
    const currentType = () => {
      const d = currentDevice();
      if (st.typeOverride[st.sn] != null) return st.typeOverride[st.sn];
      return d.installType != null ? d.installType : 1;
    };
    const latest = () => st.history[st.history.length - 1] || null;

    function renderBar() {
      $('.gia-devs').innerHTML = st.devices.map((d) => `<button data-sn="${esc(d.sn)}" class="${d.sn === st.sn ? 'active' : ''}" title="${esc(d.sn)}"><span class="gia-dot" style="background:${d.online ? '#52c41a' : '#bfbfbf'}"></span>${esc(d.name)}</button>`).join('');
      const type = currentType();
      $('.gia-types').innerHTML = [0, 1].map((t) => `<button data-t="${t}" class="${t === type ? 'active' : ''}">${STANDARDS[t].name}</button>`).join('');
      const d = currentDevice();
      $('.gia-type-note').textContent = st.typeOverride[st.sn] != null
        ? '已手动选择'
        : d.installType != null ? '来自房间布局配置' : '房间布局中未配置安装方式，默认按侧装检查，可手动切换';
      $('.gia-wins').innerHTML = WINDOWS.map(([, label], i) => `<button data-w="${i}" class="${i === settings.windowIdx ? 'active' : ''}">${label}</button>`).join('');
    }

    function renderCurrent() {
      const type = currentType(), std = STANDARDS[type], s = latest();
      const ev = s ? evaluate(s, type) : null;
      const verdict = $('.gia-verdict');
      verdict.className = `gia-verdict ${ev ? ev.overall : 'none'}`;
      if (!ev) {
        verdict.innerHTML = `<div class="icon">?</div><div><div class="t1">${st.loadingHistory ? '加载中…' : '暂无角度数据'}</div><div class="t2">${st.error ? esc(st.error) : '该设备最近没有上报带角度的心跳'}</div></div>`;
      } else {
        const bad = AXES.filter((k) => ev.axes[k].status === 'bad');
        const warn = AXES.filter((k) => ev.axes[k].status === 'warn');
        const t1 = ev.overall === 'bad' ? '安装角度超出允许范围' : ev.overall === 'warn' ? '安装角度合格（接近临界）' : '安装角度合格';
        const t2 = ev.overall === 'bad'
          ? bad.map((k) => `${k} 轴偏差 ${signed(ev.axes[k].dev)}`).join('，') + `（允许 ±${std.tol}°）`
          : ev.overall === 'warn'
            ? warn.map((k) => `${k} 轴偏差 ${signed(ev.axes[k].dev)}`).join('，') + `，已超过允许值的 75%`
            : `${std.name}标准：三轴偏差均在 ±${std.tol}° 内`;
        verdict.innerHTML = `<div class="icon">${ev.overall === 'bad' ? '✕' : ev.overall === 'warn' ? '!' : '✓'}</div><div><div class="t1">${t1}</div><div class="t2">${t2}</div></div>`;
      }

      $('.gia-table tbody').innerHTML = AXES.map((k) => {
        const a = ev && ev.axes[k];
        const stdV = std.axes[k];
        const extra = type === 1 && a
          ? k === 'y' ? `<div class="gia-note">俯角 ${deg(90 - a.value)}（标准 ${90 - stdV}°）</div>`
            : k === 'z' ? `<div class="gia-note">y + z = ${deg(ev.axes.y.value + a.value)}（应为 90°）</div>` : ''
          : '';
        return `<tr>
          <td><b>angle_${k}</b></td>
          <td class="v" style="color:${a ? COLORS[a.status] : 'inherit'}">${a ? deg(a.value, 2) : '--'}${extra}</td>
          <td>${stdV}°</td>
          <td>${stdV - std.tol}° ~ ${stdV + std.tol}°</td>
          <td>${a ? signed(a.dev, 2) : '--'}</td>
          <td>${a ? `<span class="gia-tag ${a.status}">${a.status === 'bad' ? '超限' : a.status === 'warn' ? '临界' : '正常'}</span>` : '--'}</td>
        </tr>`;
      }).join('');

      $('.gia-pitch-title').textContent = type === 1 ? '侧视：俯角（90° − angle_y）' : '侧视：z 轴与水平面夹角';
      $('.gia-pitch').innerHTML = pitchSvg(ev, type);
      $('.gia-bubble-title').textContent = type === 1 ? '水平仪：x / z 偏差' : '水平仪：x / y 偏差';
      $('.gia-bubble').innerHTML = bubbleSvg(ev, type);
      st.view3d.update(s, type, ev);
      renderMeta();
    }

    function heartbeatInterval() {
      const h = st.history;
      if (h.length < 3) return 60e3;
      const diffs = [];
      for (let i = Math.max(1, h.length - 12); i < h.length; i++) diffs.push(h[i].t - h[i - 1].t);
      diffs.sort((a, b) => a - b);
      return clamp(diffs[diffs.length >> 1], 10e3, 10 * 60e3);
    }

    function renderMeta() {
      const s = latest(), d = currentDevice();
      const parts = [];
      if (s) {
        const age = Date.now() - s.t;
        const next = heartbeatInterval() - age;
        parts.push(`最近上报 <b>${fmt(s.t)}</b>（${fmtAgo(age)}）`);
        parts.push(next > 0 ? `预计 <b>${Math.ceil(next / 1000)}</b> 秒后下次上报` : `等待上报中（已超出预计 ${Math.ceil(-next / 1000)} 秒）`);
        if (age > STALE_MS) parts.push('<span style="color:#ff4d4f">数据已过期，设备可能离线</span>');
        if (s.fw) parts.push(`固件 ${esc(s.fw)}`);
        if (s.rssi != null) parts.push(`信号 ${esc(s.rssi)} dBm`);
      }
      if (!d.online) parts.push('<span style="color:#ff4d4f">设备离线</span>');
      parts.push(`<span class="gia-live"><span class="gia-dot"></span>每 ${POLL_MS / 1000} 秒自动刷新</span>`);
      $('.gia-meta').innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
    }

    // ----- 趋势图 -----
    function renderTrend() {
      const type = currentType(), std = STANDARDS[type];
      const [winMs] = WINDOWS[settings.windowIdx];
      const t1 = Date.now(), t0 = t1 - winMs;
      const pts = st.history.filter((p) => p.t >= t0);
      const W = 960, LEFT = 92, RIGHT = 12, ROW = 74, GAP = 10, TOP = 6, AXIS = 22;
      const H = TOP + AXIS + 3 * ROW + 2 * GAP;
      const pw = W - LEFT - RIGHT;
      const xOf = (t) => LEFT + (t - t0) / winMs * pw;
      let out = '';
      const outCount = { x: 0, y: 0, z: 0 };
      AXES.forEach((k, i) => {
        const top = TOP + i * (ROW + GAP);
        const sv = std.axes[k];
        let lo = sv - std.tol * 2, hi = sv + std.tol * 2;
        for (const p of pts) { lo = Math.min(lo, p[k]); hi = Math.max(hi, p[k]); }
        const padV = (hi - lo) * 0.08;
        lo -= padV; hi += padV;
        const yOf = (v) => top + (hi - v) / (hi - lo) * ROW;
        out += `<rect x="${LEFT}" y="${top}" width="${pw}" height="${ROW}" fill="#fafafa" stroke="#e8e8e8"/>`;
        out += `<rect x="${LEFT}" y="${yOf(sv + std.tol)}" width="${pw}" height="${yOf(sv - std.tol) - yOf(sv + std.tol)}" fill="rgba(82,196,26,.13)"/>`;
        out += `<line x1="${LEFT}" x2="${LEFT + pw}" y1="${yOf(sv)}" y2="${yOf(sv)}" stroke="#52c41a" stroke-dasharray="4 3"/>`;
        out += `<text x="8" y="${top + 16}" font-size="13" font-weight="600" fill="rgba(0,0,0,.88)">angle_${k}</text>`;
        out += `<text x="8" y="${top + 34}" font-size="11" fill="rgba(0,0,0,.45)">${sv}° ±${std.tol}°</text>`;
        // 标准带太窄时合并成一个标签，避免文字重叠
        if (yOf(sv - std.tol) - yOf(sv + std.tol) < 12) {
          out += `<text x="${LEFT - 4}" y="${yOf(sv) + 4}" font-size="10" text-anchor="end" fill="#52c41a">${sv - std.tol}~${sv + std.tol}</text>`;
        } else {
          for (const v of [sv - std.tol, sv + std.tol]) {
            out += `<text x="${LEFT - 4}" y="${yOf(v) + 4}" font-size="10" text-anchor="end" fill="#52c41a">${v}</text>`;
          }
        }
        // 折线（相邻点间隔超过 3 个心跳周期则断开）
        const gap = heartbeatInterval() * 3;
        let d = '';
        pts.forEach((p, j) => {
          d += `${j && p.t - pts[j - 1].t <= gap ? 'L' : 'M'}${xOf(p.t).toFixed(1)},${yOf(p[k]).toFixed(1)}`;
        });
        if (d) out += `<path d="${d}" fill="none" stroke="#1677ff" stroke-width="1.5"/>`;
        for (const p of pts) {
          if (Math.abs(p[k] - sv) > std.tol) {
            outCount[k]++;
            out += `<circle cx="${xOf(p.t).toFixed(1)}" cy="${yOf(p[k]).toFixed(1)}" r="2.5" fill="#ff4d4f"/>`;
          }
        }
      });
      // 时间刻度
      const axisY = TOP + 3 * ROW + 2 * GAP + 14;
      const steps = [5 * 60e3, 10 * 60e3, 15 * 60e3, 30 * 60e3, 36e5, 2 * 36e5, 3 * 36e5, 6 * 36e5];
      const step = steps.find((s) => s / winMs * pw >= 110) || steps[steps.length - 1];
      const off = new Date(t0).getTimezoneOffset() * 60e3;
      for (let t = Math.ceil((t0 - off) / step) * step + off; t <= t1; t += step) {
        const x = xOf(t);
        out += `<line x1="${x}" x2="${x}" y1="${TOP}" y2="${axisY - 12}" stroke="rgba(0,0,0,.05)"/>`;
        out += `<text x="${x}" y="${axisY}" font-size="11" text-anchor="middle" fill="rgba(0,0,0,.45)">${fmtTime(new Date(t)).slice(0, 5)}</text>`;
      }
      out += `<line class="hover" x1="0" x2="0" y1="${TOP}" y2="${axisY - 12}" stroke="rgba(0,0,0,.35)" stroke-dasharray="3 3" style="display:none"/>`;
      $('.gia-trend-svg').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${out}</svg>`;
      const outTotal = AXES.reduce((n, k) => n + outCount[k], 0);
      $('.gia-trend-note').textContent = st.loadingHistory
        ? '加载中…'
        : `${pts.length} 次上报${outTotal ? `，其中 ${AXES.filter((k) => outCount[k]).map((k) => `${k} 轴超限 ${outCount[k]} 次`).join('、')}` : '，全部在允许范围内'}`;
      st.trendGeom = { W, LEFT, pw, t0, winMs, pts };
    }

    $('.gia-trend-wrap').addEventListener('mousemove', (e) => {
      const g = st.trendGeom, tip = $('.gia-tip'), svg = $('.gia-trend-svg svg');
      if (!g || !svg || !g.pts.length) return;
      const rect = svg.getBoundingClientRect();
      const vx = (e.clientX - rect.left) / rect.width * g.W;
      if (vx < g.LEFT) { tip.style.display = 'none'; return; }
      const t = g.t0 + (vx - g.LEFT) / g.pw * g.winMs;
      let best = g.pts[0];
      for (const p of g.pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      const ev = evaluate(best, currentType());
      tip.innerHTML = `<b>${fmt(best.t)}</b><br>${AXES.map((k) => `angle_${k}：<span style="color:${ev.axes[k].status === 'bad' ? '#ff7875' : '#fff'}">${deg(best[k], 2)}（${signed(ev.axes[k].dev, 2)}）</span>`).join('<br>')}`;
      tip.style.display = 'block';
      const wrap = $('.gia-trend-wrap').getBoundingClientRect();
      tip.style.left = clamp(e.clientX - wrap.left + 12, 0, wrap.width - tip.offsetWidth) + 'px';
      tip.style.top = Math.max(0, e.clientY - wrap.top - tip.offsetHeight - 8) + 'px';
      const line = svg.querySelector('.hover');
      const hx = g.LEFT + (best.t - g.t0) / g.winMs * g.pw;
      line.setAttribute('x1', hx); line.setAttribute('x2', hx); line.style.display = '';
    });
    $('.gia-trend-wrap').addEventListener('mouseleave', () => {
      $('.gia-tip').style.display = 'none';
      const line = body.querySelector('.gia-trend-svg .hover');
      if (line) line.style.display = 'none';
    });

    // ----- 数据 -----
    async function loadHistory() {
      const sn = st.sn;
      st.loadingHistory = true;
      st.error = '';
      st.history = [];
      renderCurrent();
      renderTrend();
      try {
        const [winMs] = WINDOWS[settings.windowIdx];
        let hist = await fetchHeartbeats(sn, Date.now() - winMs);
        if (!hist.length) hist = await fetchHeartbeats(sn); // 窗口内没有数据时，取最近一次上报
        if (sn !== st.sn) return;
        st.history = hist;
      } catch (e) {
        st.error = e.message;
      } finally {
        if (sn === st.sn) {
          st.loadingHistory = false;
          renderCurrent();
          renderTrend();
        }
      }
    }

    async function poll() {
      const sn = st.sn;
      if (st.loadingHistory) return;
      try {
        const rows = await fetchHeartbeats(sn);
        if (sn !== st.sn) return;
        const last = latest();
        const fresh = rows.filter((p) => !last || p.t > last.t);
        if (fresh.length) {
          st.history.push(...fresh);
          renderCurrent();
          renderTrend();
        }
      } catch (e) { /* 下次再试 */ }
    }

    body.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.sn) { st.sn = b.dataset.sn; renderBar(); loadHistory(); }
      else if (b.dataset.t != null) { st.typeOverride[st.sn] = +b.dataset.t; renderBar(); renderCurrent(); renderTrend(); }
      else if (b.dataset.w != null) { settings.windowIdx = +b.dataset.w; saveSettings(settings); renderBar(); loadHistory(); }
    });

    renderBar();
    await loadHistory();
    st.timer = setInterval(poll, POLL_MS);
    st.tickTimer = setInterval(renderMeta, 1000);
  }

  // ---------- 注入按钮 ----------

  function findIconGroup() {
    const icons = document.querySelectorAll('main .sdb-button.sdb-button__icon');
    for (const el of icons) {
      const use = el.querySelector('use');
      const href = use && (use.getAttribute('xlink:href') || use.getAttribute('href'));
      if (href === '#icon-track_') return el.parentElement;
    }
    return null;
  }

  function ensureButton() {
    if (location.pathname !== ROUTE) return;
    const group = findIconGroup();
    if (!group || group.querySelector('.gia-entry')) return;
    ensureStyle();
    const btn = document.createElement('span');
    btn.className = 'sdb-button sdb-button__icon gia-entry';
    btn.title = '安装角度检查';
    btn.innerHTML = document.getElementById('icon-ruler')
      ? '<svg class="icon" aria-hidden="true"><use xlink:href="#icon-ruler"></use></svg>'
      : RULER_SVG;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const roomId = resolveRoomId(group.firstElementChild);
      if (!roomId) { window.alert('未找到房间 ID，请先在页面上选择一个房间'); return; }
      openAngleCheck(roomId);
    });
    group.appendChild(btn);
  }

  new MutationObserver(debounce(ensureButton, 200)).observe(document.body, { childList: true, subtree: true });
  ensureButton();
})();
