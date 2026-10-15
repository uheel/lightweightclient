// ==UserScript==
// @name         雷达平台 - 房间时间回溯
// @namespace    goodlife-ops
// @version      0.1.4
// @description  在「房间详情」页增加"时间回溯"按钮：任选时间段（可跨天）复现人员轨迹与姿态，时间轴可缩放
// @match        https://rd.igoodlife.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const ROUTE = '/care/monitoring/room-view';
  const GAP_MS = 2000; // 与平台轨迹回放一致：相邻点超过 2 秒视为断开
  const STALE_MS = 10 * 60 * 1000; // 无轨迹但仍有姿态时，最多沿用 10 分钟内的最后位置
  const MAX_RANGE_DAYS = 7;
  const MIN_VIEW_SPAN = 5000;
  const SETTINGS_KEY = 'glr:settings';

  const POSTURES = {
    1: { text: '行走', color: '#1677ff' },
    2: { text: '疑似跌倒', color: '#fa8c16', alarm: true },
    3: { text: '坐', color: '#13c2c2' },
    4: { text: '静止', color: '#8c8c8c' },
    5: { text: '跌倒确认', color: '#f5222d', alarm: true },
    6: { text: '在床', color: '#722ed1' },
    7: { text: '疑似坐地', color: '#faad14', alarm: true },
    8: { text: '确认坐地告警', color: '#cf1322', alarm: true },
    9: { text: '床上坐起', color: '#2f54eb' },
    10: { text: '疑似床上坐起告警', color: '#eb2f96', alarm: true },
    11: { text: '确认床上坐起告警', color: '#c41d7f', alarm: true },
  };
  const EVENTS = {
    1: { text: '进入房间', color: '#52c41a' },
    2: { text: '离开房间', color: '#8c8c8c' },
    3: { text: '进入区域', color: '#1677ff' },
    4: { text: '离开区域', color: '#69b1ff' },
    5: { text: '进入监护区', color: '#722ed1' },
    6: { text: '退出监护区', color: '#b37feb' },
  };
  const TRACK_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#13c2c2', '#eb2f96', '#a0d911', '#2f54eb'];
  const SPEEDS = [0.5, 1, 2, 5, 10, 30, 60, 120];
  const TRAILS = [0, 5, 10, 30, 60, 300];
  const TICK_STEPS = [1e3, 2e3, 5e3, 1e4, 15e3, 3e4, 6e4, 12e4, 3e5, 6e5, 9e5, 18e5, 36e5, 72e5, 108e5, 216e5, 432e5, 864e5];

  // ---------- 工具函数 ----------

  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const fmt = (ms) => { const d = new Date(ms); return `${fmtDate(d)} ${fmtTime(d)}`; };
  const parseTime = (s) => new Date(String(s).replace(' ', 'T')).getTime();
  const toInputValue = (ms) => fmt(ms).replace(' ', 'T');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 第一个 key(item) >= v 的下标
  function lowerBound(arr, v, key) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((key ? key(arr[mid]) : arr[mid]) < v) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

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

  async function runLimited(tasks, limit, onProgress) {
    const results = new Array(tasks.length);
    let next = 0, done = 0;
    async function worker() {
      while (next < tasks.length) {
        const i = next++;
        try { results[i] = await tasks[i](); } catch (e) { results[i] = e; }
        onProgress && onProgress(++done, tasks.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
  }

  function splitRange(start, end, maxMs = 864e5) {
    const out = [];
    for (let s = start; s < end; s += maxMs) out.push([s, Math.min(end, s + maxMs)]);
    return out;
  }

  async function loadReplayData(roomId, detail, start, end, sns, onProgress) {
    const devices = (detail.devices || []).filter((d) => d.sn);
    const nameOf = Object.fromEntries(devices.map((d) => [d.sn, d.deviceName || d.sn]));
    const chunks = splitRange(start, end);
    const tasks = [];
    for (const [s, e] of chunks) {
      tasks.push(() => api('/api/human-exists/trajectory-points', {
        roomId, startAt: fmt(s), endAt: fmt(e), deviceSns: sns.join(','),
      }).then((data) => ({ kind: 'traj', data })));
    }
    for (const sn of sns) {
      for (const [s, e] of chunks) {
        tasks.push(() => api('/api/device/human-position/posture-timeline', { sn, startAt: fmt(s), endAt: fmt(e) })
          .then((data) => ({ kind: 'posture', sn, data })));
        tasks.push(() => api('/api/device/human-position/event-timeline', { sn, startAt: fmt(s), endAt: fmt(e) })
          .then((data) => ({ kind: 'event', sn, data })));
      }
    }
    const results = await runLimited(tasks, 4, onProgress);
    const errors = results.filter((r) => r instanceof Error);
    if (results.slice(0, chunks.length).some((r) => r instanceof Error)) throw errors[0];

    const trackMap = new Map();
    const getTrack = (sn, uid) => {
      const key = `${sn}:${uid}`;
      if (!trackMap.has(key)) trackMap.set(key, { key, sn, uid, points: [], postures: [] });
      return trackMap.get(key);
    };
    const seen = new Set();
    const events = [];
    for (const r of results) {
      if (!r || r instanceof Error) continue;
      if (r.kind === 'traj') {
        for (const p of r.data || []) {
          if (!sns.includes(p.sn)) continue;
          const k = `${p.sn}:${p.userId}:${p.timestamp}`;
          if (seen.has(k)) continue;
          seen.add(k);
          getTrack(p.sn, p.userId).points.push({ t: p.timestamp, x: p.x, y: p.y });
        }
      } else if (r.kind === 'posture') {
        for (const seg of (r.data && r.data.segments) || []) {
          getTrack(r.sn, seg.userId).postures.push({ s: parseTime(seg.startAt), e: parseTime(seg.endAt) + 999, p: seg.posture });
        }
      } else if (r.kind === 'event') {
        for (const ev of (r.data && r.data.events) || []) {
          events.push({ t: parseTime(ev.occurredAt), sn: r.sn, uid: ev.userId, type: ev.eventType, range: ev.rangeName });
        }
      }
    }

    // 坐标系：AIO 等设备的历史点已是房间坐标；FallSense 等设备是相对雷达的坐标，需要按安装配置换算。
    // 每台设备分别试两种解释，落在房间内的点多的那种即为正确的坐标系。
    const qcBySn = {};
    for (const el of detail.elements || []) if (el.sn && el.qingLanConfig && el.qingLanConfig.container) qcBySn[el.sn] = el.qingLanConfig;
    const bg = detail.background || {};
    const inRoom = (x, y) => x >= -30 && y >= -30 && x <= (bg.width || 0) + 30 && y <= (bg.height || 0) + 30;
    const converted = [];
    for (const sn of sns) {
      const qc = qcBySn[sn];
      const pts = [...trackMap.values()].filter((tr) => tr.sn === sn).flatMap((tr) => tr.points);
      if (!qc || !pts.length) continue;
      let rawIn = 0, xfIn = 0;
      for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 2000))) {
        if (inRoom(pts[i].x, pts[i].y)) rawIn++;
        const [X, Y] = radarToRoom(qc, pts[i].x, pts[i].y);
        if (inRoom(X, Y)) xfIn++;
      }
      if (xfIn > rawIn) {
        for (const p of pts) [p.x, p.y] = radarToRoom(qc, p.x, p.y);
        converted.push(nameOf[sn] || sn);
      }
    }

    const multiDevice = sns.length > 1;
    const tracks = [...trackMap.values()]
      .sort((a, b) => (a.sn === b.sn ? a.uid - b.uid : a.sn < b.sn ? -1 : 1))
      .map((tr, i) => {
        tr.points.sort((a, b) => a.t - b.t);
        tr.postures.sort((a, b) => a.s - b.s);
        tr.color = TRACK_COLORS[i % TRACK_COLORS.length];
        tr.label = multiDevice ? `${nameOf[tr.sn] || tr.sn} · 目标${tr.uid}` : `目标${tr.uid}`;
        // 连续出现区间，用于时间轴底色
        tr.runs = [];
        for (const p of tr.points) {
          const last = tr.runs[tr.runs.length - 1];
          if (last && p.t - last[1] < GAP_MS) last[1] = p.t; else tr.runs.push([p.t, p.t]);
        }
        return tr;
      });
    const labelOf = Object.fromEntries(tracks.map((tr) => [tr.key, tr.label]));
    events.sort((a, b) => a.t - b.t);

    const marks = [];
    for (const ev of events) {
      const def = EVENTS[ev.type] || { text: `事件${ev.type}`, color: '#999' };
      const who = labelOf[`${ev.sn}:${ev.uid}`] || (multiDevice ? `${nameOf[ev.sn]} · 目标${ev.uid}` : `目标${ev.uid}`);
      marks.push({ t: ev.t, color: def.color, text: `${who} ${def.text}${ev.range ? ' · ' + ev.range : ''}`, alarm: false });
    }
    for (const tr of tracks) {
      for (const seg of tr.postures) {
        const def = POSTURES[seg.p];
        if (def && def.alarm) marks.push({ t: seg.s, color: def.color, text: `${tr.label} ${def.text}`, alarm: true });
      }
    }
    marks.sort((a, b) => a.t - b.t);

    const allTs = [];
    for (const tr of tracks) for (const p of tr.points) allTs.push(p.t);
    allTs.sort((a, b) => a - b);

    return { tracks, events, marks, allTs, converted, warnings: errors.map((e) => e.message) };
  }

  // 雷达坐标（cm）→ 房间坐标。与平台实时页面的换算一致（RoomViewPage 模块 1922 的 e0），
  // 但历史接口的 y 轴与实时数据方向相反，需先取反。已用实时显示位置逐点核对过（侧装 / 方向右）。
  function radarToRoom(qc, x, y) {
    const cx = ((qc.radar && qc.radar.x) || 0) + qc.container.x;
    const cy = ((qc.radar && qc.radar.y) || 0) + qc.container.y;
    const yr = -y, dir = qc.installDirection;
    let X = cx, Y = cy;
    if (qc.installType === 0) { // 顶装
      if (dir === 1) { X = cx + x; Y = cy - yr; } else if (dir === 3) { X = cx - x; Y = cy + yr; }
      else if (dir === 2) { X = cx + yr; Y = cy + x; } else if (dir === 4) { X = cx - yr; Y = cy - x; }
    } else { // 侧装
      if (dir === 1) { X = cx - x; Y = cy + yr; } else if (dir === 3) { X = cx + x; Y = cy - yr; }
      else if (dir === 2) { X = cx - yr; Y = cy - x; } else if (dir === 4) { X = cx + yr; Y = cy + x; }
    }
    return [X, Y];
  }

  function postureAt(tr, t) {
    const i = lowerBound(tr.postures, t + 1, (s) => s.s) - 1;
    return i >= 0 && t <= tr.postures[i].e ? tr.postures[i].p : null;
  }

  // 某时刻的位置：2 秒内的点做线性插值；超出则沿用最近位置（标记为 stale）
  function trackStateAt(tr, t) {
    const pts = tr.points;
    const posture = postureAt(tr, t);
    const i = lowerBound(pts, t + 1, (p) => p.t) - 1;
    if (i < 0) return posture ? { posture, x: null, y: null, stale: true } : null;
    const a = pts[i];
    const age = t - a.t;
    if (age > GAP_MS) {
      if (posture && age < STALE_MS) return { posture, x: a.x, y: a.y, stale: true };
      return posture ? { posture, x: null, y: null, stale: true } : null;
    }
    let x = a.x, y = a.y;
    const b = pts[i + 1];
    if (b && b.t > a.t && b.t - a.t < GAP_MS) {
      const k = (t - a.t) / (b.t - a.t);
      x = a.x + (b.x - a.x) * k;
      y = a.y + (b.y - a.y) * k;
    }
    return { posture, x, y, stale: false };
  }

  // ---------- 样式 ----------

  const CSS = `
.glr-mask{position:fixed;inset:0;z-index:1050;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1.5715;color:rgba(0,0,0,.88);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans','PingFang SC','Microsoft YaHei',sans-serif}
.glr-modal{width:min(1360px,96vw);height:min(900px,94vh);background:#fff;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.08),0 3px 6px -4px rgba(0,0,0,.12),0 9px 28px 8px rgba(0,0,0,.05);display:flex;flex-direction:column;overflow:hidden}
.glr-modal *{box-sizing:border-box}
.glr-header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0}
.glr-title{font-size:16px;font-weight:600}
.glr-title small{font-weight:400;color:rgba(0,0,0,.45);font-size:13px;margin-left:8px}
.glr-close{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:rgba(0,0,0,.45);font-size:20px}
.glr-close:hover{background:rgba(0,0,0,.06);color:rgba(0,0,0,.88)}
.glr-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 20px;border-bottom:1px solid #f0f0f0}
.glr-toolbar label{display:inline-flex;align-items:center;gap:6px;color:rgba(0,0,0,.65)}
.glr-input{height:32px;padding:4px 11px;border:1px solid #d9d9d9;border-radius:6px;font-size:14px;color:rgba(0,0,0,.88);outline:none;background:#fff}
.glr-input:hover{border-color:#4096ff}
.glr-input:focus{border-color:#1677ff;box-shadow:0 0 0 2px rgba(5,145,255,.1)}
.glr-btn{height:32px;padding:4px 15px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;color:rgba(0,0,0,.88);font-size:14px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;transition:all .2s}
.glr-btn:hover{color:#4096ff;border-color:#4096ff}
.glr-btn:disabled{cursor:not-allowed;color:rgba(0,0,0,.25);background:rgba(0,0,0,.04);border-color:#d9d9d9}
.glr-btn-primary{background:#1677ff;border-color:#1677ff;color:#fff;box-shadow:0 2px 0 rgba(5,145,255,.1)}
.glr-btn-primary:hover{background:#4096ff;border-color:#4096ff;color:#fff}
.glr-btn-sm{height:24px;padding:0 7px;font-size:13px;border-radius:4px}
.glr-btn-icon{width:32px;padding:0}
.glr-btn-icon svg{width:14px;height:14px;fill:currentColor}
.glr-btn.active{color:#1677ff;border-color:#1677ff;background:#e6f4ff}
.glr-quick{display:inline-flex;gap:4px}
.glr-devices{display:inline-flex;flex-wrap:wrap;gap:4px 10px}
.glr-check{display:inline-flex;align-items:center;gap:4px;cursor:pointer;user-select:none;color:rgba(0,0,0,.88)!important}
.glr-check input{width:14px;height:14px;margin:0;accent-color:#1677ff;cursor:pointer}
.glr-msg{color:rgba(0,0,0,.45);font-size:13px}
.glr-msg.err{color:#ff4d4f}
.glr-body{flex:1;min-height:0;display:flex}
.glr-stage{position:relative;flex:1;min-width:0;background:#f5f5f5;overflow:hidden;cursor:grab}
.glr-stage.panning{cursor:grabbing}
.glr-stage canvas{position:absolute;left:0;top:0}
.glr-stage-tools{position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:4px}
.glr-legend{position:absolute;left:10px;bottom:8px;display:flex;flex-wrap:wrap;gap:4px 10px;max-width:calc(100% - 20px);padding:4px 8px;background:rgba(255,255,255,.85);border-radius:6px;font-size:12px;color:rgba(0,0,0,.65);pointer-events:none}
.glr-legend i,.glr-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle;flex:none}
.glr-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(0,0,0,.45);pointer-events:none}
.glr-side{width:300px;flex:none;border-left:1px solid #f0f0f0;display:flex;flex-direction:column;min-height:0}
.glr-side-title{padding:10px 14px 6px;font-weight:600;display:flex;justify-content:space-between;align-items:center}
.glr-side-title span{font-weight:400;color:rgba(0,0,0,.45);font-size:12px}
.glr-status{padding:0 14px 8px;border-bottom:1px solid #f0f0f0;max-height:40%;overflow:auto}
.glr-st-row{display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px}
.glr-st-row .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.glr-st-row .pos{color:rgba(0,0,0,.45);font-size:12px;font-variant-numeric:tabular-nums}
.glr-tag{display:inline-block;padding:0 7px;border-radius:4px;font-size:12px;line-height:20px;color:#fff;white-space:nowrap}
.glr-tag.stale{opacity:.6}
.glr-marks{flex:1;overflow:auto;padding:0 6px 8px}
.glr-mark{display:flex;align-items:flex-start;gap:6px;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px}
.glr-mark:hover{background:rgba(0,0,0,.04)}
.glr-mark.current{background:#e6f4ff}
.glr-mark .t{color:rgba(0,0,0,.45);font-variant-numeric:tabular-nums;white-space:nowrap}
.glr-mark.alarm .txt{color:#cf1322}
.glr-mark .glr-dot{margin-top:4px}
.glr-timeline{border-top:1px solid #f0f0f0;padding:6px 20px 0}
.glr-tl-tools{display:flex;align-items:center;gap:6px;font-size:12px;color:rgba(0,0,0,.45)}
.glr-tl-tools .sp{flex:1}
.glr-tl-wrap{position:relative;margin-top:4px;user-select:none}
.glr-tl-wrap canvas{position:absolute;left:0;top:0}
.glr-tl-wrap canvas.overlay{cursor:crosshair}
.glr-tip{position:absolute;z-index:2;pointer-events:none;background:rgba(0,0,0,.78);color:#fff;font-size:12px;line-height:1.6;padding:6px 8px;border-radius:6px;white-space:nowrap;display:none}
.glr-player{display:flex;align-items:center;gap:8px;padding:10px 20px 14px;flex-wrap:wrap}
.glr-player .now{margin-left:auto;font-variant-numeric:tabular-nums;font-size:15px;font-weight:600}
.glr-select{height:32px;padding:0 8px;border:1px solid #d9d9d9;border-radius:6px;font-size:14px;background:#fff;color:rgba(0,0,0,.88);outline:none}
.glr-entry{position:relative}
.glr-entry::after{content:'';position:absolute;right:-1px;top:-1px;width:6px;height:6px;border-radius:50%;background:#556ff7}
`;

  const ICONS = {
    play: '<svg viewBox="0 0 1024 1024"><path d="M256 160v704l576-352z"/></svg>',
    pause: '<svg viewBox="0 0 1024 1024"><path d="M256 160h176v704H256zM592 160h176v704H592z"/></svg>',
    start: '<svg viewBox="0 0 1024 1024"><path d="M192 160h112v704H192zM832 160v704L352 512z"/></svg>',
    prev: '<svg viewBox="0 0 1024 1024"><path d="M512 160v704L96 512zM928 160v704L512 512z"/></svg>',
    next: '<svg viewBox="0 0 1024 1024"><path d="M512 160v704l416-352zM96 160v704l416-352z"/></svg>',
    fit: '<svg viewBox="0 0 1024 1024"><path d="M160 160h256v80H240v176h-80zM864 160v256h-80V240H608v-80zM160 864V608h80v176h176v80zM864 864H608v-80h176V608h80z"/></svg>',
    plus: '<svg viewBox="0 0 1024 1024"><path d="M472 160h80v312h312v80H552v312h-80V552H160v-80h312z"/></svg>',
    minus: '<svg viewBox="0 0 1024 1024"><path d="M160 472h704v80H160z"/></svg>',
    walk: '<svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor"><path d="M560 96a80 80 0 1 1 0 160 80 80 0 0 1 0-160zM448 288l144 32 96 160 112 32-16 64-144-40-48-72-40 168 112 112v224h-72V784l-112-104-56 248h-72l96-456-64 32v136h-72V448z"/></svg>',
  };

  function ensureStyle() {
    if (document.getElementById('glr-style')) return;
    const style = document.createElement('style');
    style.id = 'glr-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ---------- 回放弹窗 ----------

  const TL = { GUTTER: 120, RIGHT: 12, OV_Y: 4, OV_H: 10, AXIS_Y: 18, AXIS_H: 30, DENS_H: 18, LANE_H: 16, LANE_GAP: 4, EV_H: 14 };

  async function openReplay(roomId) {
    ensureStyle();
    const settings = Object.assign({ speed: 1, trail: 10, skip: true, follow: true }, loadSettings());
    const now = Date.now();
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);

    const st = {
      detail: null, data: null,
      q0: today0.getTime(), q1: now, v0: today0.getTime(), v1: now,
      t: today0.getTime(), playing: false, raf: 0, lastFrame: 0,
      room: { scale: 1, ox: 0, oy: 0 },
      images: new Map(),
      markIndex: -2, statusHtml: '', lastStatusAt: 0, hover: null,
    };

    const root = document.createElement('div');
    root.className = 'glr-mask';
    root.innerHTML = `
<div class="glr-modal" role="dialog">
  <div class="glr-header">
    <span class="glr-title">时间回溯<small class="glr-room">加载房间…</small></span>
    <span class="glr-close" title="关闭 (Esc)">×</span>
  </div>
  <div class="glr-toolbar">
    <label>开始 <input type="datetime-local" step="1" class="glr-input glr-start"></label>
    <label>结束 <input type="datetime-local" step="1" class="glr-input glr-end"></label>
    <span class="glr-quick">
      <button class="glr-btn glr-btn-sm" data-q="1h">近1小时</button>
      <button class="glr-btn glr-btn-sm" data-q="6h">近6小时</button>
      <button class="glr-btn glr-btn-sm" data-q="24h">近24小时</button>
      <button class="glr-btn glr-btn-sm" data-q="today">今天</button>
      <button class="glr-btn glr-btn-sm" data-q="yesterday">昨天</button>
      <button class="glr-btn glr-btn-sm" data-q="7d">近7天</button>
    </span>
    <span class="glr-devices"></span>
    <button class="glr-btn glr-btn-primary glr-load">查询</button>
    <span class="glr-msg"></span>
  </div>
  <div class="glr-body">
    <div class="glr-stage">
      <canvas class="base"></canvas><canvas class="dyn"></canvas>
      <div class="glr-stage-tools">
        <button class="glr-btn glr-btn-icon glr-room-fit" title="自适应">${ICONS.fit}</button>
        <button class="glr-btn glr-btn-icon glr-room-in" title="放大">${ICONS.plus}</button>
        <button class="glr-btn glr-btn-icon glr-room-out" title="缩小">${ICONS.minus}</button>
      </div>
      <div class="glr-legend"></div>
      <div class="glr-empty">加载中…</div>
    </div>
    <div class="glr-side">
      <div class="glr-side-title">当前状态</div>
      <div class="glr-status"></div>
      <div class="glr-side-title">事件 / 告警 <span class="glr-mark-count"></span></div>
      <div class="glr-marks"></div>
    </div>
  </div>
  <div class="glr-timeline">
    <div class="glr-tl-tools">
      <button class="glr-btn glr-btn-sm glr-tl-in">放大</button>
      <button class="glr-btn glr-btn-sm glr-tl-out">缩小</button>
      <button class="glr-btn glr-btn-sm glr-tl-all">全部</button>
      <button class="glr-btn glr-btn-sm glr-tl-data">适应数据</button>
      <label class="glr-check"><input type="checkbox" class="glr-follow"> 跟随播放</label>
      <span class="sp"></span>
      <span class="glr-tl-span"></span>
      <span>滚轮缩放 · 拖动平移 · 单击定位 · 顶部细条为全局导航</span>
    </div>
    <div class="glr-tl-wrap"><canvas class="base"></canvas><canvas class="overlay"></canvas><div class="glr-tip"></div></div>
  </div>
  <div class="glr-player">
    <button class="glr-btn glr-btn-icon glr-to-start" title="回到开始">${ICONS.start}</button>
    <button class="glr-btn glr-btn-icon glr-prev" title="上一个事件/告警">${ICONS.prev}</button>
    <button class="glr-btn glr-btn-primary glr-btn-icon glr-play" title="播放/暂停 (空格)">${ICONS.play}</button>
    <button class="glr-btn glr-btn-icon glr-next" title="下一个事件/告警">${ICONS.next}</button>
    <label class="glr-check">倍速 <select class="glr-select glr-speed">${SPEEDS.map((s) => `<option value="${s}">${s}x</option>`).join('')}</select></label>
    <label class="glr-check">尾迹 <select class="glr-select glr-trail">${TRAILS.map((s) => `<option value="${s}">${s ? (s >= 60 ? s / 60 + ' 分钟' : s + ' 秒') : '无'}</option>`).join('')}</select></label>
    <label class="glr-check" title="播放时自动跳过没有轨迹点的时段"><input type="checkbox" class="glr-skip"> 跳过无人时段</label>
    <span class="now">--</span>
  </div>
</div>`;
    document.body.appendChild(root);

    const $ = (sel) => root.querySelector(sel);
    const els = {
      room: $('.glr-room'), start: $('.glr-start'), end: $('.glr-end'), devices: $('.glr-devices'),
      load: $('.glr-load'), msg: $('.glr-msg'), stage: $('.glr-stage'), roomBase: $('.glr-stage canvas.base'),
      roomDyn: $('.glr-stage canvas.dyn'), legend: $('.glr-legend'), empty: $('.glr-empty'), status: $('.glr-status'),
      marks: $('.glr-marks'), markCount: $('.glr-mark-count'), tlWrap: $('.glr-tl-wrap'), tlBase: $('.glr-tl-wrap canvas.base'),
      tlOver: $('.glr-tl-wrap canvas.overlay'), tip: $('.glr-tip'), tlSpan: $('.glr-tl-span'), play: $('.glr-play'),
      now: $('.glr-player .now'), speed: $('.glr-speed'), trail: $('.glr-trail'), skip: $('.glr-skip'), follow: $('.glr-follow'),
    };
    els.speed.value = String(settings.speed);
    els.trail.value = String(settings.trail);
    els.skip.checked = !!settings.skip;
    els.follow.checked = !!settings.follow;
    els.start.value = toInputValue(st.q0);
    els.end.value = toInputValue(st.q1);

    const setMsg = (text, isErr) => { els.msg.textContent = text || ''; els.msg.classList.toggle('err', !!isErr); };
    const persist = () => {
      Object.assign(settings, { speed: +els.speed.value, trail: +els.trail.value, skip: els.skip.checked, follow: els.follow.checked });
      saveSettings(settings);
    };

    // ----- 关闭 -----
    const ro = new ResizeObserver(() => { resizeRoom(); resizeTimeline(); });
    function close() {
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      document.removeEventListener('keydown', onKey, true);
      root.remove();
    }
    $('.glr-close').addEventListener('click', close);
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });

    // ----- 房间画布 -----
    const dpr = () => window.devicePixelRatio || 1;

    function sizeCanvas(cv, w, h) {
      const r = dpr();
      cv.width = Math.max(1, Math.round(w * r));
      cv.height = Math.max(1, Math.round(h * r));
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
    }

    function roomBounds() {
      const bg = (st.detail && st.detail.background) || { width: 400, height: 400 };
      return { x: 0, y: 0, w: bg.width || 400, h: bg.height || 400 };
    }

    function fitRoom() {
      const W = els.stage.clientWidth, H = els.stage.clientHeight, m = 40;
      const b = roomBounds();
      const scale = Math.max(0.05, Math.min((W - 2 * m) / b.w, (H - 2 * m) / b.h));
      st.room = { scale, ox: (W - b.w * scale) / 2 - b.x * scale, oy: (H - b.h * scale) / 2 - b.y * scale };
      drawRoomBase();
      drawRoomDyn();
    }

    function resizeRoom() {
      const W = els.stage.clientWidth, H = els.stage.clientHeight;
      sizeCanvas(els.roomBase, W, H);
      sizeCanvas(els.roomDyn, W, H);
      if (st.detail) fitRoom();
    }

    function zoomRoom(factor, cx, cy) {
      const r = st.room;
      const scale = clamp(r.scale * factor, 0.05, 20);
      const k = scale / r.scale;
      st.room = { scale, ox: cx - k * (cx - r.ox), oy: cy - k * (cy - r.oy) };
      drawRoomBase();
      drawRoomDyn();
    }

    function getImage(src) {
      if (!src) return null;
      if (st.images.has(src)) return st.images.get(src);
      const img = new Image();
      img.onload = () => drawRoomBase();
      img.src = src;
      st.images.set(src, img);
      return img;
    }

    function worldTransform(ctx) {
      const r = dpr(), v = st.room;
      ctx.setTransform(r * v.scale, 0, 0, r * v.scale, r * v.ox, r * v.oy);
    }

    function drawElement(ctx, el, s) {
      const w = el.width || 0, h = el.height || 0;
      const img = getImage(el.src);
      const qc = el.qingLanConfig;
      ctx.save();
      if (el.type === 3 && qc && qc.container) {
        // 与平台一致：雷达图标以中心对齐，位置取 radar + container（不是元素自身的 x/y）
        ctx.translate(((qc.radar && qc.radar.x) || 0) + qc.container.x, ((qc.radar && qc.radar.y) || 0) + qc.container.y);
        if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);
        if (img && img.complete && img.naturalWidth) ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
        return;
      }
      ctx.translate(el.x || 0, el.y || 0);
      if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);
      if (el.scaleX || el.scaleY) ctx.scale(el.scaleX || 1, el.scaleY || 1);
      if (el.opacity != null) ctx.globalAlpha = el.opacity;
      if (el.type === 1) {
        for (const child of el.children || []) drawElement(ctx, child, s);
      } else if (el.type === 5) {
        ctx.fillStyle = el.fill || '#000';
        ctx.font = `${el.fontSize || 14}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(el.text || '', 0, 0);
      } else if (el.type === 6 && Array.isArray(el.points)) {
        ctx.strokeStyle = el.stroke || '#333';
        ctx.lineWidth = el.strokeWidth || 1;
        ctx.beginPath();
        for (let i = 0; i + 1 < el.points.length; i += 2) {
          i ? ctx.lineTo(el.points[i], el.points[i + 1]) : ctx.moveTo(el.points[i], el.points[i + 1]);
        }
        ctx.stroke();
      } else if (img && img.complete && img.naturalWidth) {
        ctx.drawImage(img, 0, 0, w, h);
      } else if (el.type === 2 || el.fill || el.stroke) {
        ctx.beginPath();
        if (el.cornerRadius && ctx.roundRect) ctx.roundRect(0, 0, w, h, el.cornerRadius); else ctx.rect(0, 0, w, h);
        if (el.fill) { ctx.fillStyle = el.fill; ctx.fill(); }
        ctx.strokeStyle = el.stroke || '#bbb';
        ctx.lineWidth = el.stroke ? (el.strokeWidth || 1) : 1 / s;
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#bbb';
        ctx.lineWidth = 1 / s;
        ctx.strokeRect(0, 0, w, h);
      }
      ctx.restore();
    }

    function drawRoomBase() {
      const ctx = els.roomBase.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, els.roomBase.width, els.roomBase.height);
      if (!st.detail) return;
      const s = st.room.scale;
      const bg = st.detail.background || {};
      const b = roomBounds();
      worldTransform(ctx);
      // 房间底色；背景为图片（type 4）时是户型底图，否则画 1m 网格
      ctx.fillStyle = bg.fill || '#fff';
      ctx.strokeStyle = bg.stroke || '#ccc';
      ctx.lineWidth = (bg.strokeWidth || 2);
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.fill();
      const bgImg = getImage(bg.src);
      if (bgImg && bgImg.complete && bgImg.naturalWidth) {
        ctx.drawImage(bgImg, b.x, b.y, b.w, b.h);
      } else if (!bg.src) {
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(0,0,0,.05)';
        ctx.lineWidth = 1 / s;
        for (let x = 100; x < b.w; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, b.h); ctx.stroke(); }
        for (let y = 100; y < b.h; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(b.w, y); ctx.stroke(); }
        ctx.restore();
      }

      const elements = st.detail.elements || [];
      // 雷达区域（门、监护床等），坐标在雷达 container 坐标系内
      for (const el of elements) {
        const qc = el.qingLanConfig;
        if (!qc || !qc.container) continue;
        for (const rg of qc.ranges || []) {
          const x = qc.container.x + rg.x, y = qc.container.y + rg.y;
          ctx.fillStyle = rg.fill || 'rgba(22,119,255,.2)';
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x, y, rg.width, rg.height);
          ctx.globalAlpha = 1;
          if (rg.text) {
            ctx.fillStyle = 'rgba(0,0,0,.55)';
            ctx.font = `${12 / s}px sans-serif`;
            ctx.textBaseline = 'top';
            ctx.fillText(rg.text, x + 4 / s, y + 4 / s);
          }
        }
      }
      // 家具、设备等元素（类型：1 组合 2 矩形 3 设备 4 图片 5 文字 6 线条 7 床位）
      for (const el of elements) drawElement(ctx, el, s);
      ctx.lineWidth = (bg.strokeWidth || 2);
      ctx.strokeStyle = bg.stroke || '#ccc';
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }

    function drawRoomDyn() {
      const cv = els.roomDyn, ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (!st.data) return;
      const v = st.room, r = dpr(), t = st.t;
      const trailMs = (+els.trail.value || 0) * 1000;
      const toScreen = (x, y) => [v.ox + x * v.scale, v.oy + y * v.scale];

      for (const tr of st.data.tracks) {
        // 尾迹
        if (trailMs > 0 && tr.points.length) {
          const pts = tr.points;
          const i0 = lowerBound(pts, t - trailMs, (p) => p.t);
          const i1 = lowerBound(pts, t + 1, (p) => p.t);
          ctx.setTransform(r, 0, 0, r, 0, 0);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = tr.color;
          for (let i = i0 + 1; i < i1; i++) {
            const a = pts[i - 1], b = pts[i];
            if (b.t - a.t >= GAP_MS) continue;
            const k = 1 - (t - b.t) / trailMs;
            ctx.globalAlpha = 0.1 + 0.8 * k;
            ctx.lineWidth = 1 + 3 * k;
            const [ax, ay] = toScreen(a.x, a.y), [bx, by] = toScreen(b.x, b.y);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        // 当前位置
        const s = trackStateAt(tr, t);
        if (!s || s.x == null) continue;
        const [sx, sy] = toScreen(s.x, s.y);
        const pdef = POSTURES[s.posture];
        const fill = pdef ? pdef.color : tr.color;
        ctx.setTransform(r, 0, 0, r, 0, 0);
        ctx.globalAlpha = s.stale ? 0.55 : 1;
        if (pdef && pdef.alarm) {
          const pulse = 14 + 6 * Math.abs(Math.sin(performance.now() / 250));
          ctx.beginPath(); ctx.arc(sx, sy, pulse, 0, Math.PI * 2);
          ctx.fillStyle = fill; ctx.globalAlpha = 0.25; ctx.fill();
          ctx.globalAlpha = s.stale ? 0.55 : 1;
        }
        ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = tr.color;
        if (s.stale) ctx.setLineDash([3, 3]);
        ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2);
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
        // 标签
        const label = `${tr.label} ${pdef ? pdef.text : ''}`.trim();
        ctx.font = '12px sans-serif';
        const w = ctx.measureText(label).width + 12;
        const lx = sx - w / 2, ly = sy - 34;
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = pdef ? pdef.color : '#595959';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(lx, ly, w, 20, 4); else ctx.rect(lx, ly, w, 20);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx + 6, ly + 10);
      }
      ctx.globalAlpha = 1;
    }

    // 房间画布交互：滚轮缩放、拖动平移
    els.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = els.stage.getBoundingClientRect();
      zoomRoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    els.stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      els.stage.setPointerCapture(e.pointerId);
      els.stage.classList.add('panning');
      let lx = e.clientX, ly = e.clientY;
      const move = (ev) => {
        st.room.ox += ev.clientX - lx; st.room.oy += ev.clientY - ly;
        lx = ev.clientX; ly = ev.clientY;
        drawRoomBase(); drawRoomDyn();
      };
      const up = () => {
        els.stage.classList.remove('panning');
        els.stage.removeEventListener('pointermove', move);
        els.stage.removeEventListener('pointerup', up);
      };
      els.stage.addEventListener('pointermove', move);
      els.stage.addEventListener('pointerup', up);
    });
    $('.glr-room-fit').addEventListener('click', fitRoom);
    $('.glr-room-in').addEventListener('click', () => zoomRoom(1.25, els.stage.clientWidth / 2, els.stage.clientHeight / 2));
    $('.glr-room-out').addEventListener('click', () => zoomRoom(1 / 1.25, els.stage.clientWidth / 2, els.stage.clientHeight / 2));

    // ----- 时间轴 -----
    function tlLayout() {
      const n = st.data ? Math.max(1, st.data.tracks.length) : 1;
      const densTop = TL.AXIS_Y + TL.AXIS_H;
      const lanesTop = densTop + TL.DENS_H + 6;
      const evTop = lanesTop + n * (TL.LANE_H + TL.LANE_GAP);
      return { densTop, lanesTop, evTop, height: evTop + TL.EV_H + 8 };
    }
    const plotW = () => els.tlWrap.clientWidth - TL.GUTTER - TL.RIGHT;
    const xOf = (t) => TL.GUTTER + (t - st.v0) / (st.v1 - st.v0) * plotW();
    const tOf = (x) => st.v0 + (x - TL.GUTTER) / plotW() * (st.v1 - st.v0);
    const xOv = (t) => TL.GUTTER + (t - st.q0) / (st.q1 - st.q0) * plotW();
    const tOv = (x) => st.q0 + (x - TL.GUTTER) / plotW() * (st.q1 - st.q0);

    function resizeTimeline() {
      const L = tlLayout();
      els.tlWrap.style.height = L.height + 'px';
      sizeCanvas(els.tlBase, els.tlWrap.clientWidth, L.height);
      sizeCanvas(els.tlOver, els.tlWrap.clientWidth, L.height);
      drawTimelineBase();
      drawTimelineOverlay();
    }

    function clampView() {
      const full = st.q1 - st.q0;
      let span = clamp(st.v1 - st.v0, Math.min(MIN_VIEW_SPAN, full), full);
      if (st.v0 < st.q0) st.v0 = st.q0;
      st.v1 = st.v0 + span;
      if (st.v1 > st.q1) { st.v1 = st.q1; st.v0 = st.q1 - span; }
    }

    function setView(v0, v1) {
      st.v0 = v0; st.v1 = v1;
      clampView();
      drawTimelineBase();
      drawTimelineOverlay(st.hover ? st.hover.x : null);
      if (st.hover) showTip(st.hover.x, st.hover.y); else els.tip.style.display = 'none';
    }

    function zoomTimeline(factor, anchorT) {
      const span = (st.v1 - st.v0) * factor;
      const k = (anchorT - st.v0) / (st.v1 - st.v0);
      const full = st.q1 - st.q0;
      const s2 = clamp(span, Math.min(MIN_VIEW_SPAN, full), full);
      setView(anchorT - k * s2, anchorT - k * s2 + s2);
    }

    function fitData() {
      const d = st.data;
      if (!d) return;
      let a = Infinity, b = -Infinity;
      if (d.allTs.length) { a = d.allTs[0]; b = d.allTs[d.allTs.length - 1]; }
      for (const tr of d.tracks) if (tr.postures.length) { a = Math.min(a, tr.postures[0].s); b = Math.max(b, tr.postures[tr.postures.length - 1].e); }
      if (d.marks.length) { a = Math.min(a, d.marks[0].t); b = Math.max(b, d.marks[d.marks.length - 1].t); }
      if (!isFinite(a)) return setView(st.q0, st.q1);
      const padMs = Math.max(30000, (b - a) * 0.03);
      setView(a - padMs, b + padMs);
    }

    function pickStep(span, width) {
      for (const s of TICK_STEPS) if (s / span * width >= 90) return s;
      return TICK_STEPS[TICK_STEPS.length - 1];
    }

    function fmtSpan(ms) {
      if (ms < 6e4) return `${Math.round(ms / 1000)} 秒`;
      if (ms < 36e5) return `${(ms / 6e4).toFixed(ms < 6e5 ? 1 : 0)} 分钟`;
      if (ms < 864e5) return `${(ms / 36e5).toFixed(1)} 小时`;
      return `${(ms / 864e5).toFixed(1)} 天`;
    }

    function drawTimelineBase() {
      const cv = els.tlBase, ctx = cv.getContext('2d');
      const W = els.tlWrap.clientWidth, L = tlLayout(), r = dpr(), pw = plotW();
      ctx.setTransform(r, 0, 0, r, 0, 0);
      ctx.clearRect(0, 0, W, L.height);
      els.tlSpan.textContent = `视图跨度 ${fmtSpan(st.v1 - st.v0)}`;
      ctx.font = '12px sans-serif';
      ctx.textBaseline = 'middle';
      const d = st.data;

      // 全局导航条
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(TL.GUTTER, TL.OV_Y, pw, TL.OV_H);
      if (d && d.allTs.length) {
        const bins = Math.max(1, Math.floor(pw / 2)), binMs = (st.q1 - st.q0) / bins;
        ctx.fillStyle = '#91caff';
        for (let i = 0; i < bins; i++) {
          const a = lowerBound(d.allTs, st.q0 + i * binMs), b = lowerBound(d.allTs, st.q0 + (i + 1) * binMs);
          if (b > a) ctx.fillRect(TL.GUTTER + i * 2, TL.OV_Y, 2, TL.OV_H);
        }
        for (const m of d.marks) if (m.alarm) { ctx.fillStyle = m.color; ctx.fillRect(xOv(m.t) - 0.5, TL.OV_Y, 1.5, TL.OV_H); }
      }
      const vx0 = xOv(st.v0), vx1 = Math.max(xOv(st.v1), vx0 + 3);
      ctx.fillStyle = 'rgba(22,119,255,.15)';
      ctx.fillRect(vx0, TL.OV_Y - 2, vx1 - vx0, TL.OV_H + 4);
      ctx.strokeStyle = '#1677ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(vx0 + 0.5, TL.OV_Y - 1.5, vx1 - vx0 - 1, TL.OV_H + 3);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillText('全局', 8, TL.OV_Y + TL.OV_H / 2);

      // 刻度
      const span = st.v1 - st.v0, step = pickStep(span, pw);
      const off = new Date(st.v0).getTimezoneOffset() * 60000;
      let tick = Math.ceil((st.v0 - off) / step) * step + off;
      const axisLine = TL.AXIS_Y + TL.AXIS_H;
      ctx.strokeStyle = '#d9d9d9';
      ctx.beginPath(); ctx.moveTo(TL.GUTTER, axisLine + 0.5); ctx.lineTo(TL.GUTTER + pw, axisLine + 0.5); ctx.stroke();
      let lastDay = '';
      for (; tick <= st.v1; tick += step) {
        const x = Math.round(xOf(tick)) + 0.5;
        const dt = new Date(tick);
        ctx.strokeStyle = '#d9d9d9';
        ctx.beginPath(); ctx.moveTo(x, axisLine - 5); ctx.lineTo(x, axisLine); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.04)';
        ctx.beginPath(); ctx.moveTo(x, axisLine); ctx.lineTo(x, L.evTop + TL.EV_H); ctx.stroke();
        const label = step < 6e4 ? fmtTime(dt) : fmtTime(dt).slice(0, 5);
        ctx.fillStyle = 'rgba(0,0,0,.65)';
        ctx.textAlign = 'center';
        ctx.fillText(label, x, axisLine - 12);
        const day = `${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        if (day !== lastDay) {
          ctx.fillStyle = 'rgba(0,0,0,.45)';
          ctx.fillText(day, x, axisLine - 25);
          lastDay = day;
        }
      }
      ctx.textAlign = 'left';

      // 轨迹点密度
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillText('轨迹点', 8, L.densTop + TL.DENS_H / 2 + 2);
      if (d && d.allTs.length) {
        const bins = Math.max(1, Math.floor(pw / 2)), binMs = span / bins;
        const counts = new Array(bins);
        let max = 1;
        for (let i = 0; i < bins; i++) {
          const a = lowerBound(d.allTs, st.v0 + i * binMs), b = lowerBound(d.allTs, st.v0 + (i + 1) * binMs);
          counts[i] = b - a;
          if (counts[i] > max) max = counts[i];
        }
        ctx.fillStyle = '#69b1ff';
        for (let i = 0; i < bins; i++) {
          if (!counts[i]) continue;
          const h = Math.max(2, counts[i] / max * (TL.DENS_H - 2));
          ctx.fillRect(TL.GUTTER + i * 2, L.densTop + TL.DENS_H - h + 2, 1.6, h);
        }
      }

      // 每个目标一条泳道：灰色 = 有轨迹，彩色 = 姿态
      const tracks = d ? d.tracks : [];
      tracks.forEach((tr, i) => {
        const y = L.lanesTop + i * (TL.LANE_H + TL.LANE_GAP);
        ctx.fillStyle = tr.color;
        ctx.beginPath(); ctx.arc(12, y + TL.LANE_H / 2, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.88)';
        let label = tr.label;
        while (ctx.measureText(label).width > TL.GUTTER - 28 && label.length > 2) label = label.slice(0, -2) + '…';
        ctx.fillText(label, 20, y + TL.LANE_H / 2 + 1);
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(TL.GUTTER, y, pw, TL.LANE_H);
        ctx.fillStyle = '#d9d9d9';
        for (const [a, b] of tr.runs) {
          if (b < st.v0 || a > st.v1) continue;
          const x0 = Math.max(TL.GUTTER, xOf(a)), x1 = Math.min(TL.GUTTER + pw, xOf(b));
          ctx.fillRect(x0, y + TL.LANE_H - 4, Math.max(1, x1 - x0), 4);
        }
        for (const seg of tr.postures) {
          if (seg.e < st.v0 || seg.s > st.v1) continue;
          const pdef = POSTURES[seg.p];
          const x0 = Math.max(TL.GUTTER, xOf(seg.s)), x1 = Math.min(TL.GUTTER + pw, xOf(seg.e));
          ctx.fillStyle = pdef ? pdef.color : '#bfbfbf';
          ctx.fillRect(x0, y + (pdef && pdef.alarm ? 0 : 2), Math.max(1, x1 - x0), TL.LANE_H - (pdef && pdef.alarm ? 4 : 6));
        }
      });
      if (!tracks.length) {
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.fillText(d ? '该时间段没有轨迹与姿态数据' : '查询后显示', TL.GUTTER + 8, L.lanesTop + TL.LANE_H / 2);
      }

      // 事件
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillText('事件', 8, L.evTop + TL.EV_H / 2 + 1);
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(TL.GUTTER, L.evTop, pw, TL.EV_H);
      if (d) {
        for (const ev of d.events) {
          if (ev.t < st.v0 || ev.t > st.v1) continue;
          ctx.fillStyle = (EVENTS[ev.type] || {}).color || '#999';
          ctx.fillRect(xOf(ev.t) - 1, L.evTop, 2, TL.EV_H);
        }
      }
    }

    function drawTimelineOverlay(hoverX) {
      const cv = els.tlOver, ctx = cv.getContext('2d');
      const W = els.tlWrap.clientWidth, L = tlLayout(), r = dpr();
      ctx.setTransform(r, 0, 0, r, 0, 0);
      ctx.clearRect(0, 0, W, L.height);
      if (hoverX != null) {
        ctx.strokeStyle = 'rgba(0,0,0,.35)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(hoverX + 0.5, TL.AXIS_Y + TL.AXIS_H); ctx.lineTo(hoverX + 0.5, L.height); ctx.stroke();
        ctx.setLineDash([]);
      }
      // 全局导航条上的播放头
      ctx.fillStyle = '#ff4d4f';
      ctx.fillRect(xOv(st.t) - 1, TL.OV_Y - 2, 2, TL.OV_H + 4);
      if (st.t < st.v0 || st.t > st.v1) return;
      const x = Math.round(xOf(st.t)) + 0.5;
      const top = TL.AXIS_Y + TL.AXIS_H;
      ctx.strokeStyle = '#ff4d4f';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, L.height); ctx.stroke();
      ctx.fillStyle = '#ff4d4f';
      ctx.beginPath(); ctx.moveTo(x - 6, top - 7); ctx.lineTo(x + 6, top - 7); ctx.lineTo(x, top); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1;
    }

    function showTip(x, y) {
      const d = st.data, L = tlLayout();
      if (x < TL.GUTTER || x > TL.GUTTER + plotW() || y < TL.AXIS_Y) { els.tip.style.display = 'none'; return; }
      const t = tOf(x);
      const lines = [`<b>${fmt(t)}</b>`];
      if (d) {
        const laneIdx = Math.floor((y - L.lanesTop) / (TL.LANE_H + TL.LANE_GAP));
        d.tracks.forEach((tr, i) => {
          const p = postureAt(tr, t);
          const pdef = POSTURES[p];
          if (pdef || i === laneIdx) {
            lines.push(`<span class="glr-dot" style="background:${tr.color}"></span>${esc(tr.label)}：${pdef ? `<span style="color:${pdef.color === '#8c8c8c' ? '#d9d9d9' : pdef.color}">${pdef.text}</span>` : '—'}`);
          }
        });
        const tol = (st.v1 - st.v0) / plotW() * 4;
        const near = d.marks.filter((m) => Math.abs(m.t - t) <= tol).slice(0, 5);
        for (const m of near) lines.push(`<span class="glr-dot" style="background:${m.color}"></span>${fmtTime(new Date(m.t))} ${esc(m.text)}`);
      }
      els.tip.innerHTML = lines.join('<br>');
      els.tip.style.display = 'block';
      const tw = els.tip.offsetWidth, W = els.tlWrap.clientWidth;
      els.tip.style.left = clamp(x + 12, 0, W - tw) + 'px';
      els.tip.style.top = Math.max(0, y - els.tip.offsetHeight - 8) + 'px';
    }

    // 时间轴交互：滚轮缩放（Shift+滚轮平移）、拖动平移、单击定位、导航条拖动
    els.tlOver.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!st.data) return;
      const x = e.offsetX;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dv = (e.deltaX || e.deltaY) / plotW() * (st.v1 - st.v0);
        setView(st.v0 + dv, st.v1 + dv);
      } else {
        // 按滚动量缩放：普通鼠标一格约 1.2 倍，触控板更细腻
        const delta = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
        const anchor = x >= TL.GUTTER ? tOf(x) : st.t;
        zoomTimeline(Math.exp(clamp(delta, -1500, 1500) * 0.002), anchor);
      }
    }, { passive: false });

    els.tlOver.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !st.data) return;
      els.tlOver.setPointerCapture(e.pointerId);
      const inOverview = e.offsetY <= TL.OV_Y + TL.OV_H + 4;
      const startX = e.offsetX, v0 = st.v0, v1 = st.v1;
      let moved = false;
      if (inOverview) {
        const span = v1 - v0, c = tOv(startX);
        setView(c - span / 2, c + span / 2);
      }
      const move = (ev) => {
        const dx = ev.offsetX - startX;
        if (Math.abs(dx) > 3) moved = true;
        if (inOverview) {
          const span = v1 - v0, c = tOv(ev.offsetX);
          setView(c - span / 2, c + span / 2);
        } else if (moved) {
          const dv = -dx / plotW() * (v1 - v0);
          setView(v0 + dv, v1 + dv);
        }
      };
      const up = (ev) => {
        els.tlOver.removeEventListener('pointermove', move);
        els.tlOver.removeEventListener('pointerup', up);
        if (!inOverview && !moved && ev.offsetX >= TL.GUTTER) seek(tOf(ev.offsetX));
      };
      els.tlOver.addEventListener('pointermove', move);
      els.tlOver.addEventListener('pointerup', up);
    });
    els.tlOver.addEventListener('dblclick', (e) => { if (st.data && e.offsetX >= TL.GUTTER) zoomTimeline(0.5, tOf(e.offsetX)); });
    els.tlOver.addEventListener('mousemove', (e) => {
      st.hover = { x: e.offsetX, y: e.offsetY };
      drawTimelineOverlay(e.offsetX >= TL.GUTTER && e.offsetY > TL.AXIS_Y ? e.offsetX : null);
      showTip(e.offsetX, e.offsetY);
    });
    els.tlOver.addEventListener('mouseleave', () => { st.hover = null; els.tip.style.display = 'none'; drawTimelineOverlay(); });
    $('.glr-tl-in').addEventListener('click', () => zoomTimeline(0.5, inView(st.t) ? st.t : (st.v0 + st.v1) / 2));
    $('.glr-tl-out').addEventListener('click', () => zoomTimeline(2, inView(st.t) ? st.t : (st.v0 + st.v1) / 2));
    $('.glr-tl-all').addEventListener('click', () => setView(st.q0, st.q1));
    $('.glr-tl-data').addEventListener('click', fitData);

    const inView = (t) => t >= st.v0 && t <= st.v1;

    // ----- 播放 -----
    function seek(t, fromPlayback) {
      st.t = clamp(t, st.q0, st.q1);
      if (els.follow.checked && !inView(st.t)) {
        const span = st.v1 - st.v0;
        const v0 = fromPlayback ? st.t - span * 0.1 : st.t - span / 2;
        setView(v0, v0 + span);
      } else {
        drawTimelineOverlay(st.hover ? st.hover.x : null);
      }
      renderFrame();
    }

    function renderFrame() {
      drawRoomDyn();
      const d = new Date(st.t);
      els.now.textContent = `${fmt(st.t)}.${Math.floor(d.getMilliseconds() / 100)}`;
      const nowMs = performance.now();
      if (!st.playing || nowMs - st.lastStatusAt > 150) {
        st.lastStatusAt = nowMs;
        updateStatus();
        updateMarkHighlight();
      }
    }

    function updateStatus() {
      if (!st.data) return;
      const rows = st.data.tracks.map((tr) => {
        const s = trackStateAt(tr, st.t);
        const pdef = s && POSTURES[s.posture];
        const tag = pdef
          ? `<span class="glr-tag${s.stale ? ' stale' : ''}" style="background:${pdef.color}">${pdef.text}</span>`
          : `<span class="glr-tag" style="background:${s ? '#bfbfbf' : '#e8e8e8'};color:${s ? '#fff' : 'rgba(0,0,0,.45)'}">${s ? '未知姿态' : '不在场'}</span>`;
        const pos = s && s.x != null ? `${(s.x / 100).toFixed(2)}, ${(s.y / 100).toFixed(2)} m${s.stale ? ' (最近)' : ''}` : '';
        return `<div class="glr-st-row"><span class="glr-dot" style="background:${tr.color}"></span><span class="name" title="${esc(tr.label)}">${esc(tr.label)}</span>${tag}</div>${pos ? `<div class="glr-st-row" style="padding-top:0;padding-left:14px"><span class="pos">${pos}</span></div>` : ''}`;
      });
      const html = rows.join('') || '<div class="glr-st-row" style="color:rgba(0,0,0,.45)">无目标</div>';
      if (html !== st.statusHtml) { els.status.innerHTML = html; st.statusHtml = html; }
    }

    function updateMarkHighlight() {
      if (!st.data) return;
      const idx = lowerBound(st.data.marks, st.t + 1, (m) => m.t) - 1;
      if (idx === st.markIndex) return;
      const prev = els.marks.querySelector('.glr-mark.current');
      if (prev) prev.classList.remove('current');
      st.markIndex = idx;
      const cur = idx >= 0 ? els.marks.children[idx] : null;
      if (cur) {
        cur.classList.add('current');
        cur.scrollIntoView({ block: 'nearest' });
      }
    }

    function play() {
      if (!st.data) return;
      if (st.t >= st.q1) st.t = st.q0;
      st.playing = true;
      st.lastFrame = performance.now();
      els.play.innerHTML = ICONS.pause;
      st.raf = requestAnimationFrame(tick);
    }
    function pause() {
      st.playing = false;
      cancelAnimationFrame(st.raf);
      els.play.innerHTML = ICONS.play;
      renderFrame();
    }
    function tick(nowMs) {
      if (!st.playing) return;
      const dt = Math.min(200, nowMs - st.lastFrame);
      st.lastFrame = nowMs;
      let t = st.t + dt * (+els.speed.value || 1);
      const d = st.data;
      if (els.skip.checked && d.allTs.length) {
        const i = lowerBound(d.allTs, t);
        const prev = i > 0 ? d.allTs[i - 1] : -Infinity, next = i < d.allTs.length ? d.allTs[i] : Infinity;
        const anyPosture = d.tracks.some((tr) => postureAt(tr, t) != null);
        if (!anyPosture && t - prev > GAP_MS && next - t > 3000) {
          const nextMark = d.marks[lowerBound(d.marks, t, (m) => m.t)];
          const target = Math.min(next, nextMark ? nextMark.t : Infinity);
          if (isFinite(target)) t = target - 500;
        }
      }
      if (t >= st.q1) { seek(st.q1, true); pause(); return; }
      seek(t, true);
      st.raf = requestAnimationFrame(tick);
    }

    function jumpMark(dir) {
      const marks = st.data ? st.data.marks : [];
      if (!marks.length) return;
      let m;
      if (dir > 0) m = marks[lowerBound(marks, st.t + 1500, (x) => x.t)];
      else { const i = lowerBound(marks, st.t - 1500, (x) => x.t) - 1; m = marks[i]; }
      if (m) seek(m.t - 2000);
    }

    els.play.addEventListener('click', () => (st.playing ? pause() : play()));
    $('.glr-to-start').addEventListener('click', () => {
      const d = st.data;
      seek(d && d.allTs.length ? Math.max(st.q0, d.allTs[0] - 1000) : st.q0);
    });
    $('.glr-prev').addEventListener('click', () => jumpMark(-1));
    $('.glr-next').addEventListener('click', () => jumpMark(1));
    for (const el of [els.speed, els.trail, els.skip, els.follow]) el.addEventListener('change', () => { persist(); renderFrame(); });

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); st.playing ? pause() : play(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation();
        seek(st.t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10000 : 1000));
      } else if (e.key === '+' || e.key === '=') zoomTimeline(0.5, st.t);
      else if (e.key === '-') zoomTimeline(2, st.t);
    }
    document.addEventListener('keydown', onKey, true);

    // ----- 事件列表 -----
    function renderMarks() {
      const marks = st.data.marks;
      const multiDay = fmtDate(new Date(st.q0)) !== fmtDate(new Date(st.q1 - 1));
      els.markCount.textContent = marks.length ? `${marks.filter((m) => m.alarm).length} 告警 / ${marks.length} 条` : '';
      els.marks.innerHTML = marks.length
        ? marks.map((m, i) => `<div class="glr-mark${m.alarm ? ' alarm' : ''}" data-i="${i}"><span class="glr-dot" style="background:${m.color}"></span><span class="t">${multiDay ? fmt(m.t).slice(5) : fmtTime(new Date(m.t))}</span><span class="txt">${esc(m.text)}</span></div>`).join('')
        : '<div class="glr-mark" style="cursor:default;color:rgba(0,0,0,.45)">无事件</div>';
      st.markIndex = -2;
    }
    els.marks.addEventListener('click', (e) => {
      const item = e.target.closest('.glr-mark[data-i]');
      if (!item) return;
      const m = st.data.marks[+item.dataset.i];
      const span = st.v1 - st.v0;
      if (!inView(m.t)) setView(m.t - span / 2, m.t + span / 2);
      seek(m.t - 2000);
    });

    function renderLegend() {
      const used = new Set();
      if (st.data) for (const tr of st.data.tracks) for (const s of tr.postures) used.add(s.p);
      const keys = used.size ? [...used].sort((a, b) => a - b) : Object.keys(POSTURES).map(Number);
      els.legend.innerHTML = keys.filter((k) => POSTURES[k]).map((k) => `<span><i style="background:${POSTURES[k].color}"></i>${POSTURES[k].text}</span>`).join('');
    }

    // ----- 查询 -----
    function selectedSns() {
      return [...els.devices.querySelectorAll('input:checked')].map((i) => i.value);
    }

    async function query() {
      const start = new Date(els.start.value).getTime();
      const end = new Date(els.end.value).getTime();
      if (!isFinite(start) || !isFinite(end) || end <= start) return setMsg('请填写正确的开始和结束时间', true);
      if (end - start > MAX_RANGE_DAYS * 864e5) return setMsg(`时间段不能超过 ${MAX_RANGE_DAYS} 天`, true);
      const sns = selectedSns();
      if (!sns.length) return setMsg('请至少选择一台设备', true);
      pause();
      els.load.disabled = true;
      setMsg('加载中…');
      try {
        const data = await loadReplayData(roomId, st.detail, start, end, sns, (done, total) => setMsg(`加载中… ${done}/${total}`));
        st.data = data;
        st.q0 = start; st.q1 = end;
        const pts = data.allTs.length;
        setMsg(`${data.tracks.length} 个目标 · ${pts} 个轨迹点 · ${data.events.length} 个事件${data.converted.length ? ` · 已按安装方向换算坐标：${data.converted.join('、')}` : ''}${data.warnings.length ? ` · ${data.warnings.length} 个请求失败：${data.warnings[0]}` : ''}`, data.warnings.length > 0);
        els.empty.style.display = pts || data.tracks.length ? 'none' : 'flex';
        els.empty.textContent = '该时间段没有轨迹数据';
        renderMarks();
        renderLegend();
        resizeTimeline();
        fitData();
        const first = pts ? data.allTs[0] : (data.marks[0] ? data.marks[0].t : start);
        seek(Math.max(start, first - 1000));
      } catch (e) {
        setMsg(e.message || String(e), true);
      } finally {
        els.load.disabled = false;
      }
    }
    els.load.addEventListener('click', query);

    root.querySelectorAll('.glr-quick button').forEach((btn) => btn.addEventListener('click', () => {
      const n = Date.now(), d0 = new Date(); d0.setHours(0, 0, 0, 0);
      const q = btn.dataset.q;
      const ranges = {
        '1h': [n - 36e5, n], '6h': [n - 6 * 36e5, n], '24h': [n - 864e5, n], '7d': [n - 7 * 864e5, n],
        today: [d0.getTime(), n], yesterday: [d0.getTime() - 864e5, d0.getTime()],
      };
      const [a, b] = ranges[q];
      els.start.value = toInputValue(a);
      els.end.value = toInputValue(b);
      query();
    }));

    // ----- 初始化 -----
    ro.observe(els.stage);
    ro.observe(els.tlWrap);
    resizeTimeline();
    renderLegend();
    try {
      st.detail = await api('/api/room-view/v3/detail', { roomId });
    } catch (e) {
      els.empty.textContent = '加载房间失败：' + e.message;
      return;
    }
    const det = st.detail;
    els.room.textContent = [det.buildingName, det.floorName, det.roomName].filter(Boolean).join(' / ');
    const devices = (det.devices || []).filter((dv) => dv.sn);
    els.devices.innerHTML = devices.length
      ? devices.map((dv) => `<label class="glr-check" title="${esc(dv.sn)}"><input type="checkbox" value="${esc(dv.sn)}" checked>${esc(dv.deviceName || dv.sn)}${dv.isOnline ? '' : ' <span style="color:rgba(0,0,0,.45)">(离线)</span>'}</label>`).join('')
      : '<span class="glr-msg err">该房间没有绑定设备</span>';
    resizeRoom();
    els.empty.textContent = '请选择时间段后点击"查询"';
    if (devices.length) query();
  }

  // ---------- 注入按钮 ----------

  // 当前显示的房间：优先读页面组件的 roomId（不同入口进来时 URL 不一定带参数），再看 URL 和最近的房间详情请求
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

  function findIconGroup() {
    const icons = document.querySelectorAll('main .sdb-button.sdb-button__icon:not(.glr-entry)');
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
    if (!group || group.querySelector('.glr-entry')) return;
    ensureStyle();
    const btn = document.createElement('span');
    btn.className = 'sdb-button sdb-button__icon glr-entry';
    btn.title = '时间回溯（可跨天、带姿态、时间轴可缩放）';
    btn.innerHTML = document.getElementById('icon-walk')
      ? '<svg class="icon" aria-hidden="true"><use xlink:href="#icon-walk"></use></svg>'
      : ICONS.walk;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const roomId = resolveRoomId(group.firstElementChild);
      if (!roomId) { window.alert('未找到房间 ID，请先在页面上选择一个房间'); return; }
      openReplay(roomId);
    });
    group.appendChild(btn);
  }

  new MutationObserver(debounce(ensureButton, 200)).observe(document.body, { childList: true, subtree: true });
  ensureButton();
})();
