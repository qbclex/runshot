/* 轨迹模板：全部在「米」坐标系内生成，渲染时再投影到像素 */
(function (global) {
  'use strict';
  const R = global.RNG;
  const PI = Math.PI;
  const TAU = PI * 2;

  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  function polyLen(pts, closed) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    if (closed && pts.length > 2) L += dist(pts[pts.length - 1], pts[0]);
    return L;
  }

  /* ---------- 基础形状 ---------- */

  // 标准 400m 跑道：直道 84.39m + 半径 36.5m
  function stadium(L, R0, step) {
    L = L || 84.39; R0 = R0 || 36.5; step = step || 2;
    const pts = [];
    const half = L / 2;
    for (let x = -half; x <= half; x += step) pts.push([x, -R0]);
    const arcLen = PI * R0;
    const n = Math.max(8, Math.round(arcLen / step));
    for (let i = 1; i <= n; i++) {
      const a = -PI / 2 + PI * i / n;
      pts.push([half + R0 * Math.cos(a), R0 * Math.sin(a)]);
    }
    for (let x = half; x >= -half; x -= step) pts.push([x, R0]);
    for (let i = 1; i < n; i++) {
      const a = PI / 2 + PI * i / n;
      pts.push([-half + R0 * Math.cos(a), R0 * Math.sin(a)]);
    }
    return { pts, closed: true };
  }

  function roundRect(w, h, r, step) {
    step = step || 3;
    const pts = [];
    const hw = w / 2, hh = h / 2;
    const seg = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(len / step));
      for (let i = 0; i < n; i++) pts.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
    };
    const arc = (cx, cy, a0, a1) => {
      const len = Math.abs(a1 - a0) * r;
      const n = Math.max(2, Math.ceil(len / step));
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * i / n;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    seg(-hw + r, -hh, hw - r, -hh); arc(hw - r, -hh + r, -PI / 2, 0);
    seg(hw, -hh + r, hw, hh - r); arc(hw - r, hh - r, 0, PI / 2);
    seg(hw - r, hh, -hw + r, hh); arc(-hw + r, hh - r, PI / 2, PI);
    seg(-hw, hh - r, -hw, -hh + r); arc(-hw + r, -hh + r, PI, PI * 1.5);
    return { pts, closed: true };
  }

  function parkLoop(R0, rng) {
    const p1 = rng.float(0, TAU), p2 = rng.float(0, TAU);
    const wobble = rng.float(0.10, 0.18);
    const pts = [];
    const N = 240;
    for (let i = 0; i < N; i++) {
      const a = TAU * i / N;
      const r = R0 * (1 + wobble * Math.sin(3 * a + p1) + 0.09 * Math.sin(5 * a + p2));
      pts.push([r * Math.cos(a), r * Math.sin(a) * 0.8]);
    }
    return { pts, closed: true };
  }

  function lemniscate(A, B) {
    const pts = [];
    const N = 260;
    for (let i = 0; i < N; i++) {
      const t = TAU * i / N;
      pts.push([A * Math.sin(t), B * Math.sin(t) * Math.cos(t)]);
    }
    return { pts, closed: true };
  }

  // 开放式「去—回」走廊：去程一条曲线，回程平移 offset 米
  function corridor(len, amp, waves, rng) {
    const pts = [];
    const N = 150;
    const ph = rng.float(0, TAU);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push([(t - 0.5) * len, amp * Math.sin(t * PI * waves + ph)]);
    }
    return { pts, closed: false };
  }

  /* ---------- 组合：把基础形状按里程铺开 ---------- */

  function rotate(pts, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return pts.map(p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]);
  }

  const NAMES = {
    block: '居住街区环线',
    park: '城市公园环线',
    track: '市体育中心田径场',
    outback: '滨河健身步道',
    river: '滨江绿道',
    figure8: '湖心公园环线'
  };

  function makeBase(kind, rng, targetLen) {
    const len = Math.max(700, targetLen / 2);
    switch (kind) {
      case 'track': return stadium();
      case 'park': return parkLoop(rng.float(260, 330), rng);
      case 'figure8': return lemniscate(340, 210);
      case 'outback': return corridor(len, len * 0.065, 1.4, rng);
      case 'river': return corridor(len, len * 0.10, 1.1, rng);
      case 'block':
      default: return roundRect(460, 300, 78);
    }
  }

  function build(kind, targetLen, rng) {
    const base = makeBase(kind, rng, targetLen);
    const rotation = kind === 'track' ? 0 : rng.float(0, TAU);
    const baseLen = polyLen(base.pts, base.closed);
    const cycleLen = base.closed ? baseLen : baseLen * 2;
    const cycles = Math.max(0.6, targetLen / Math.max(120, cycleLen));
    const full = Math.floor(cycles);
    const frac = cycles - full;

    const jitter = 0.38;
    const out = [];
    const push = (p, ox, oy) => out.push([p[0] + ox + rng.gauss(0, jitter), p[1] + oy + rng.gauss(0, jitter)]);
    // 折返类路线的回程偏移（基准坐标系内垂直于主线）
    const backOff = Math.max(85, baseLen * (kind === 'river' ? 0.06 : 0.045));

    for (let c = 0; c < full; c++) {
      const ox = rng.float(-0.4, 0.4);
      const oy = rng.float(-0.4, 0.4);
      if (base.closed) {
        for (const p of base.pts) push(p, ox, oy);
        push(base.pts[0], ox, oy);
      } else {
        for (const p of base.pts) push(p, ox, oy);
        for (let i = base.pts.length - 1; i >= 0; i--) push(base.pts[i], ox, oy + backOff);
      }
    }

    // 收尾的不足一圈部分
    const nPart = Math.round(frac * base.pts.length);
    if (base.closed) {
      for (let i = 0; i < nPart; i++) push(base.pts[i], 0, 0);
    } else if (frac > 0) {
      const half = Math.round(frac * 2 * base.pts.length);
      if (half <= base.pts.length) {
        for (let i = 0; i < half; i++) push(base.pts[i], 0, 0);
      } else {
        for (const p of base.pts) push(p, 0, 0);
        const back = half - base.pts.length;
        for (let i = base.pts.length - 1; i >= Math.max(0, base.pts.length - back); i--) push(base.pts[i], 0, backOff);
      }
    }

    // 整体旋转到随机朝向
    let pts = rotation ? rotate(out, rotation) : out;
    if (pts.length > 7000) {
      const step = Math.ceil(pts.length / 7000);
      pts = pts.filter((_, i) => i % step === 0);
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }

    return {
      kind,
      name: NAMES[kind] || '户外跑步',
      rotation,
      track: kind === 'track' ? { halfL: 84.39 / 2, r: 36.5 } : null,
      points: pts,
      bbox: { minX, maxX, minY, maxY },
      laps: Math.round(cycles * 100) / 100,
      baseLen: Math.round(baseLen)
    };
  }

  /* 手绘轨迹（用户在选点地图上描的线）：
     - 按等距柱状投影到以轨迹质心为原点的米坐标（y 向南为正，与渲染约定一致）
     - 闭环：按目标里程换算圈数（描一圈操场、设 5 km → 自动跑 12 圈并带 ±0.5 m 换道漂移）
     - 非闭环：整条缩放到目标里程 */
  function buildUser(strokes, targetLen, rng) {
    const flat = [];
    (strokes || []).forEach(s => (s || []).forEach(p => {
      const la = +p[0], lo = +p[1];
      if (!isFinite(la) || !isFinite(lo)) return;
      const last = flat[flat.length - 1];
      if (last && last[0] === la && last[1] === lo) return;
      flat.push([la, lo]);
    }));
    if (flat.length < 2) return null;

    const lat0 = flat.reduce((s, p) => s + p[0], 0) / flat.length;
    const lon0 = flat.reduce((s, p) => s + p[1], 0) / flat.length;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 111320;
    const m = flat.map(p => [(p[1] - lon0) * kx, (lat0 - p[0]) * ky]);

    let geoLen = 0;
    for (let i = 1; i < m.length; i++) geoLen += Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]);
    if (geoLen < 30) return null;

    // 闭环判定：首尾距离小于 6% 周长（且至少 12 m）
    const endGap = Math.hypot(m[0][0] - m[m.length - 1][0], m[0][1] - m[m.length - 1][1]);
    const closed = endGap < Math.max(12, geoLen * 0.06);

    // 弧长重采样成均匀点列
    const step = Math.max(5, geoLen / 240);
    const rs = [m[0].slice()];
    let need = step;
    let cur = m[0].slice();
    for (let i = 1; i < m.length; i++) {
      let dx = m[i][0] - cur[0], dy = m[i][1] - cur[1];
      let d = Math.hypot(dx, dy);
      let guard = 0;
      while (d >= need && guard++ < 5000) {
        const t = need / d;
        cur = [cur[0] + dx * t, cur[1] + dy * t];
        rs.push(cur.slice());
        dx = m[i][0] - cur[0];
        dy = m[i][1] - cur[1];
        d = Math.hypot(dx, dy);
        need = step;
      }
      need -= d;
      cur = m[i].slice();
    }
    if (rs.length < 2) rs.push(m[m.length - 1].slice());

    let rsLen = 0;
    for (let i = 1; i < rs.length; i++) rsLen += Math.hypot(rs[i][0] - rs[i - 1][0], rs[i][1] - rs[i - 1][1]);
    if (rsLen < 25) return null;

    // 组装：闭环换圈数（封顶 60 圈，再多说明画的圈太小、目标里程太大，退化为整体缩放）
    const jitter = Math.max(0.3, geoLen * 0.0012);
    let pts = [];
    let laps = 1;
    if (closed && targetLen >= rsLen * 0.72 && targetLen / rsLen <= 60) {
      laps = Math.max(1, Math.round(targetLen / rsLen));
      for (let c = 0; c < laps; c++) {
        const ox = rng.float(-0.35, 0.35);
        const oy = (c % 2 ? 1 : -1) * rng.float(0.15, 0.6);
        for (const p of rs) pts.push([p[0] + ox + rng.gauss(0, jitter), p[1] + oy + rng.gauss(0, jitter)]);
        pts.push([rs[0][0] + ox + rng.gauss(0, jitter), rs[0][1] + oy + rng.gauss(0, jitter)]);
      }
    } else {
      for (const p of rs) pts.push([p[0] + rng.gauss(0, jitter), p[1] + rng.gauss(0, jitter)]);
    }

    // 统一缩放到目标里程（圈数取整后的余量也在这里消化掉）
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const k = targetLen / total;
    pts = pts.map(p => [p[0] * k, p[1] * k]);
    if (pts.length > 6000) {
      const stp = Math.ceil(pts.length / 6000);
      pts = pts.filter((_, i) => i % stp === 0 || i === pts.length - 1);
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }

    return {
      kind: 'userdraw',
      name: '自定义地图',
      rotation: 0,
      user: true,
      closed,
      origin: { lat: lat0, lon: lon0 },
      points: pts,
      bbox: { minX, maxX, minY, maxY },
      laps: closed ? laps : 1,
      baseLen: Math.round(rsLen)
    };
  }

  global.Routes = { build, buildUser, NAMES, KIND_LIST: ['block', 'park', 'track', 'outback', 'river', 'figure8'] };
})(window);
