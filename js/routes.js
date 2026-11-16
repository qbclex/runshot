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

  function bboxOf(pts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    return { minX, maxX, minY, maxY };
  }

  /* ---------- 闭环逐圈生成 ---------- */

  function arcTable(pts) {
    const N = pts.length;
    const cum = new Float64Array(N + 1);
    for (let i = 1; i <= N; i++) cum[i] = cum[i - 1] + dist(pts[i - 1], pts[i % N]);
    return { cum, total: cum[N] };
  }

  // 沿环线弧长 s 处的位置
  function sampleArc(pts, tab, s) {
    const total = tab.total;
    s = s % total;
    if (s < 0) s += total;
    let lo = 0, hi = pts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (tab.cum[mid] <= s) lo = mid; else hi = mid;
    }
    const a = pts[lo], b = pts[(lo + 1) % pts.length];
    const seg = tab.cum[lo + 1] - tab.cum[lo];
    const t = seg > 1e-9 ? (s - tab.cum[lo]) / seg : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  /* 按里程沿基准环线绕圈。真实跑步不会每圈换到一条干净的新道：
     更多时候是贴着上一条道、压线，或者只偏出去一点点。所以每圈的横向偏移
     用「约四成半原地压住上一圈、其余走一道」的随机游走，再叠加跨圈连续的
     GPS 慢漂（幅度 1~2 m）和每圈独立的径向小偏差，轨迹就一圈圈随机叠在一起、
     部分路段互相压线，而不是整齐的同心圈。换道在起跑线之后 blend 米内平滑过渡，
     末尾不足一圈按里程截断；起终点由里程与单圈长共同决定。 */
  function lapRun(basePts, targetLen, lanes, rng, opt) {
    opt = opt || {};
    const step = opt.step || 2;
    const jit = opt.jitter == null ? 0.15 : opt.jitter;
    const drift = opt.drift == null ? 1.6 : opt.drift;
    const tab = arcTable(basePts);
    const lapLen = tab.total;
    const blend = Math.min(opt.blend || 12, lapLen * 0.06);
    const nL = lanes.length;

    let cx = 0, cy = 0;
    for (const p of basePts) { cx += p[0]; cy += p[1]; }
    cx /= basePts.length; cy /= basePts.length;

    const n = Math.max(24, Math.round(targetLen / step));
    const nLaps = Math.ceil(targetLen / lapLen) + 2;

    // 每圈的道次：从「家道次」出发做有反弹的随机游走，约四成半原地压住上一圈，
    // 其余走一道、偶尔一次跨两道；再给每圈一个独立的径向小偏差，
    // 避免轨迹落在几条整齐的等间距线上
    const lapOff = new Array(nLaps);
    const lapNoise = opt.lapNoise == null ? 0.6 : opt.lapNoise;
    const home = Math.max(0, Math.min(nL - 1, opt.home == null ? Math.floor((nL - 1) / 2) : opt.home));
    let li = home;
    for (let k = 0; k < nLaps; k++) {
      lapOff[k] = lanes[li] + rng.gauss(0, lapNoise);
      const r = rng.float(0, 1);
      if (r < 0.45) continue;
      let d = r < 0.62 ? -1 : 1;
      if (r > 0.93) d *= 2;
      li += d;
      if (li < 0) li = -li;
      if (li > nL - 1) li = 2 * (nL - 1) - li;
      li = Math.max(0, Math.min(nL - 1, li));
    }
    // 真实场地按测量线换算里程：把各圈横向偏移的均值归零，
    // 免得整体偏到外道把折线长度拉长
    if (opt.center) {
      let m = 0;
      for (let k = 0; k < nLaps; k++) m += lapOff[k];
      m /= nLaps;
      for (let k = 0; k < nLaps; k++) lapOff[k] -= m;
    }

    // 跨圈连续的横向慢漂：波长是单圈的一半上下，所以每圈的漂移相位不同，
    // 相邻圈会在部分路段压在一起、部分路段分开
    const A1 = drift, L1 = lapLen * rng.float(0.35, 0.6), p1 = rng.float(0, TAU);
    const A2 = drift * 0.15, L2 = lapLen * rng.float(0.25, 0.4), p2 = rng.float(0, TAU);

    const dS = Math.min(3, lapLen * 0.01);
    const pts = new Array(n);
    for (let i = 0; i < n; i++) {
      const s = targetLen * i / (n - 1);
      const q = sampleArc(basePts, tab, s);
      const lapI = Math.floor(s / lapLen);
      let off = lapOff[lapI];
      if (lapI > 0) {
        const t = Math.min(1, (s - lapI * lapLen) / blend);
        const w = t * t * (3 - 2 * t);
        off = lapOff[lapI - 1] + (off - lapOff[lapI - 1]) * w;
      }
      off += A1 * Math.sin(TAU * s / L1 + p1) + A2 * Math.sin(TAU * s / L2 + p2);

      // 切向取前后 dS 米的割线：手绘折线的锯齿不至于让法线逐点乱跳，
      // 否则横向偏移一放大，轨迹就会被拉长
      const qa = sampleArc(basePts, tab, s - dS);
      const qb = sampleArc(basePts, tab, s + dS);
      let tx = qb[0] - qa[0], ty = qb[1] - qa[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      let nx = -ty, ny = tx;
      if ((q[0] - cx) * nx + (q[1] - cy) * ny < 0) { nx = -nx; ny = -ny; }

      const o = off + rng.gauss(0, jit);
      pts[i] = [q[0] + nx * o, q[1] + ny * o];
    }
    return { pts, lapLen, laps: targetLen / lapLen };
  }

  /* ---------- 基础形状 ---------- */

  // 标准 400m 跑道：直道 84.39m + 半径 36.8m（测量线距内沿 0.3m）
  // 2×84.39 + 2π×36.8 = 400.0 m，单圈正好 400 m，圈数可直接用里程 ÷ 400 换算
  function stadium(L, R0, step) {
    L = L || 84.39; R0 = R0 || 36.8; step = step || 2;
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

  // 标准跑道上常用的四条道次（距测量线向外的横向偏移，米）：半径 36.9 / 39.2 / 41.5 / 43.8 m
  const TRACK_LANES = [0.1, 2.4, 4.7, 7.0];

  function build(kind, targetLen, rng) {
    const base = makeBase(kind, rng, targetLen);
    const rotation = kind === 'track' ? 0 : rng.float(0, TAU);
    const baseLen = polyLen(base.pts, base.closed);

    // 田径场：单圈 400 m，圈数 = 里程 ÷ 400；逐圈随机漂移压线，起终点落在 400 m 起跑线上
    if (kind === 'track') {
      const run = lapRun(base.pts, targetLen, TRACK_LANES, rng, { step: 2, jitter: 0.1, drift: 1.7, home: 0 });
      return {
        kind,
        name: NAMES.track,
        rotation: 0,
        track: { halfL: 84.39 / 2, r: 36.8 },
        multiLap: true,
        points: run.pts,
        bbox: bboxOf(run.pts),
        laps: Math.round(run.laps * 100) / 100,
        baseLen: Math.round(baseLen)
      };
    }

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
     - 闭环：单圈长 = 描出来的环线周长，圈数 = 目标里程 ÷ 单圈长；
       逐圈横向换道，轨迹呈一圈一圈分开的套圈（描一圈操场、设 5 km → 约 13 圈）
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
    // 补齐重采样丢掉的尾段，否则单圈长会短掉最多 step 米
    const lastIn = m[m.length - 1];
    const lastRs = rs[rs.length - 1];
    if (Math.hypot(lastIn[0] - lastRs[0], lastIn[1] - lastRs[1]) > 0.5) rs.push(lastIn.slice());
    if (rs.length < 2) rs.push(m[m.length - 1].slice());

    let rsLen = 0;
    for (let i = 1; i < rs.length; i++) rsLen += Math.hypot(rs[i][0] - rs[i - 1][0], rs[i][1] - rs[i - 1][1]);
    if (rsLen < 25) return null;

    // 组装：闭环按 里程 ÷ 单圈长 换算圈数（封顶 60 圈，再多说明画的圈太小、
    // 目标里程太大，退化为整体缩放）；逐圈横向换道，画出来就是一圈一圈的
    const jitter = Math.max(0.3, geoLen * 0.0012);
    let pts = [];
    let laps = 1;
    let multiLap = false;
    let lapFitted = false;
    if (closed && targetLen >= rsLen * 0.72 && targetLen / rsLen <= 60) {
      laps = Math.max(1, Math.round(targetLen / rsLen));
      const rb = bboxOf(rs);
      const extent = Math.max(rb.maxX - rb.minX, rb.maxY - rb.minY);
      const gap = Math.min(6, Math.max(0.9, extent * 0.022));
      const nL = Math.min(4, Math.max(1, Math.floor(targetLen / rsLen)));
      const lanes = [];
      for (let i = 0; i < nL; i++) lanes.push((i - (nL - 1) / 2) * gap);
      const run = lapRun(rs, targetLen, lanes, rng, {
        step: Math.max(1.5, rsLen / 500),
        jitter: Math.max(0.12, geoLen * 0.0004),
        drift: Math.min(2.2, gap * 0.55)
      });
      pts = run.pts;
      multiLap = nL > 1;
      lapFitted = true;
    } else {
      for (const p of rs) pts.push([p[0] + rng.gauss(0, jitter), p[1] + rng.gauss(0, jitter)]);
    }

    // 单圈轨迹整体缩放到目标里程；套圈轨迹保持描线原尺寸，
    // 好和地图上的真实跑道对齐（实测折线比标称里程长约 5–10%，来自换道绕外圈）。
    if (!lapFitted) {
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const k = targetLen / total;
      pts = pts.map(p => [p[0] * k, p[1] * k]);
    }
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
      multiLap,
      origin: { lat: lat0, lon: lon0 },
      points: pts,
      bbox: { minX, maxX, minY, maxY },
      laps: closed ? laps : 1,
      baseLen: Math.round(rsLen)
    };
  }

  global.Routes = { build, buildUser, NAMES, KIND_LIST: ['block', 'park', 'track', 'outback', 'river', 'figure8'] };
})(window);
