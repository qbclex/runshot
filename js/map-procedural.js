/* 离线程序化底图：按「米」坐标系生成浅色规划图（街区 / 道路 / 公园 / 水系 / 楼栋标注） */
(function (global) {
  'use strict';
  const R = global.RNG.Rng;

  const POI = ['市民活动中心', '社区公园', '滨河绿道', '实验小学', '文化广场', '地铁站', '全民健身中心', '中心公园'];

  function draw(ctx, view, record) {
    const rng = new R((record.mapSeed || 1) ^ 0x9e3779b9);
    const rect = view.rect, S = view.scale, X = view.X, Y = view.Y;
    const wx0 = view.cx - (rect.w / 2) / S, wx1 = view.cx + (rect.w / 2) / S;
    const wy0 = view.cy - (rect.h / 2) / S, wy1 = view.cy + (rect.h / 2) / S;
    const mpx = m => Math.max(0.9, m * S);

    ctx.save();
    ctx.fillStyle = '#f7f7f5';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    /* ---- 街区骨架（按屏幕密度自适应，避免缩太小时变成噪点） ---- */
    const cw = Math.max(126, 46 / S);
    const ch = cw * 0.82;
    const xs = [], ys = [];
    let gx = Math.floor(wx0 / cw) * cw - cw;
    while (gx < wx1 + cw) { xs.push(gx + rng.float(-11, 11)); gx += cw; }
    let gy = Math.floor(wy0 / ch) * ch - ch;
    while (gy < wy1 + ch) { ys.push(gy + rng.float(-9, 9)); gy += ch; }

    /* ---- 水系 ---- */
    const hasRiver = rng.chance(0.55);
    if (hasRiver) {
      const rx = wx0 + (wx1 - wx0) * rng.float(0.1, 0.9);
      const amp = rng.float(30, 70), kk = rng.float(0.003, 0.007), ph = rng.float(0, 6.28);
      ctx.beginPath();
      let first = true;
      for (let y = wy0 - 90; y <= wy1 + 90; y += 16) {
        const x = rx + amp * Math.sin(y * kk + ph);
        if (first) { ctx.moveTo(X(x), Y(y)); first = false; } else ctx.lineTo(X(x), Y(y));
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = mpx(42);
      ctx.strokeStyle = '#dae9f3';
      ctx.stroke();
      ctx.lineWidth = mpx(29);
      ctx.strokeStyle = '#e6f1f8';
      ctx.stroke();
    } else if (rng.chance(0.55)) {
      const cx0 = wx0 + (wx1 - wx0) * rng.float(0.2, 0.8);
      const cy0 = wy0 + (wy1 - wy0) * rng.float(0.2, 0.8);
      ctx.beginPath();
      ctx.ellipse(X(cx0), Y(cy0), mpx(rng.float(45, 95)), mpx(rng.float(30, 65)), rng.float(0, 3), 0, Math.PI * 2);
      ctx.fillStyle = '#e2eff8';
      ctx.fill();
    }

    /* ---- 公园街区 ---- */
    const parkCells = new Set();
    const parkCount = rng.int(1, 3);
    for (let t = 0; t < parkCount; t++) {
      if (xs.length < 3 || ys.length < 3) break;
      const i = rng.int(0, xs.length - 3), j = rng.int(0, ys.length - 3);
      parkCells.add(i + ':' + j);
      const px = X(xs[i]), py = Y(ys[j]);
      const pw = X(xs[i + 1]) - px, ph2 = Y(ys[j + 1]) - py;
      ctx.fillStyle = '#e7f2db';
      ctx.fillRect(px, py, pw, ph2);
      for (let q = 0; q < 9; q++) {
        ctx.beginPath();
        ctx.fillStyle = 'rgba(146,188,126,0.34)';
        ctx.arc(px + rng.float(10, pw - 10), py + rng.float(10, ph2 - 10), mpx(rng.float(5, 11)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* ---- 道路 ---- */
    ctx.lineCap = 'butt';
    const roadPass = (list, vertical) => {
      list.forEach((v, i) => {
        const major = i % 3 === 0;
        const wpx = Math.max(major ? 4.2 : 2.3, (major ? 15 : 9) * S);
        ctx.beginPath();
        if (vertical) { ctx.moveTo(X(v), rect.y - 4); ctx.lineTo(X(v), rect.y + rect.h + 4); }
        else { ctx.moveTo(rect.x - 4, Y(v)); ctx.lineTo(rect.x + rect.w + 4, Y(v)); }
        ctx.lineWidth = wpx + 1.4;
        ctx.strokeStyle = '#eae7df';
        ctx.stroke();
        ctx.lineWidth = wpx;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      });
    };
    roadPass(xs, true);
    roadPass(ys, false);

    /* ---- 楼栋 ---- */
    const buildings = [];
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < ys.length - 1; j++) {
        if (parkCells.has(i + ':' + j)) continue;
        const bx0 = xs[i] + 10, bx1 = xs[i + 1] - 10;
        const by0 = ys[j] + 10, by1 = ys[j + 1] - 10;
        const bw = bx1 - bx0, bh = by1 - by0;
        if (bw < 26 || bh < 24) continue;
        const big = rng.chance(0.08);
        const cols = big ? 1 : Math.max(1, Math.min(3, Math.round(bw / 60)));
        const rows = big ? 1 : Math.max(1, Math.min(3, Math.round(bh / 48)));
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            if (!big && rng.chance(0.12)) continue;
            const pad = rng.float(2, 6);
            const x0 = bx0 + bw * c / cols + pad;
            const y0 = by0 + bh * r / rows + pad;
            const w = bw / cols - pad * 2 - rng.float(0, 3);
            const h = bh / rows - pad * 2 - rng.float(0, 3);
            if (w <= 5 || h <= 5) continue;
            const rr = { x: X(x0), y: Y(y0), w: X(x0 + w) - X(x0), h: Y(y0 + h) - Y(y0) };
            if (rr.w < 1.6 || rr.h < 1.6) continue;
            ctx.fillStyle = rng.chance(0.5) ? '#ecebe9' : '#efeeeb';
            ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
            ctx.strokeStyle = '#e2e1dd';
            ctx.lineWidth = 0.65;
            ctx.strokeRect(rr.x + 0.3, rr.y + 0.3, rr.w - 0.6, rr.h - 0.6);
            buildings.push(rr);
          }
        }
      }
    }

    /* ---- 操场（跑道模板专用底图） ---- */
    if (record.routeKind === 'track' && record.route.track) {
      const tk = record.route.track;
      const cxPx = X(view.cx), cyPx = Y(view.cy);
      const halfL = tk.halfL * S;
      const stadium = (rad) => {
        const rp = rad * S;
        ctx.beginPath();
        ctx.moveTo(cxPx - halfL, cyPx - rp);
        ctx.lineTo(cxPx + halfL, cyPx - rp);
        ctx.arc(cxPx + halfL, cyPx, rp, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(cxPx - halfL, cyPx + rp);
        ctx.arc(cxPx - halfL, cyPx, rp, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();
      };
      stadium(46);
      ctx.fillStyle = '#c58376';
      ctx.fill();
      stadium(36.2);
      ctx.fillStyle = '#b6d29a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.30)';
      ctx.lineWidth = 0.6;
      [37.9, 39.1, 40.3, 41.5, 42.7, 43.9].forEach(rad => { stadium(rad); ctx.stroke(); });
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      stadium(36.2);
      ctx.stroke();
      // 内场足球场
      if (S > 0.45) {
        const fw = 100 * S, fh = 60 * S;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(cxPx - fw / 2, cyPx - fh / 2, fw, fh);
        ctx.beginPath();
        ctx.moveTo(cxPx, cyPx - fh / 2);
        ctx.lineTo(cxPx, cyPx + fh / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cxPx, cyPx, 9.15 * S, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeRect(cxPx - fw / 2, cyPx - 20 * S, 16 * S, 40 * S);
        ctx.strokeRect(cxPx + fw / 2 - 16 * S, cyPx - 20 * S, 16 * S, 40 * S);
      }
    }

    /* ---- POI（先放，避免楼栋标注与它重叠） ---- */
    view.labels = [];
    if (record.routeKind === 'track') { ctx.restore(); return; }
    const poiName = rng.pick(POI);
    const px0 = wx0 + (wx1 - wx0) * rng.float(0.1, 0.32);
    const py0 = wy0 + (wy1 - wy0) * rng.float(0.68, 0.86);
    const cxp = X(px0), cyp = Y(py0);
    ctx.beginPath();
    ctx.fillStyle = '#4d97c6';
    ctx.arc(cxp, cyp, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(77,151,198,0.32)';
    ctx.lineWidth = 2.2;
    ctx.arc(cxp, cyp, 5.6, 0, Math.PI * 2);
    ctx.stroke();
    view.labels.push({ text: poiName, x: cxp + 7, y: cyp + 0.5, size: 9.5, color: '#3d80ab', align: 'left' });

    /* ---- 楼栋标注（收进 view.labels，由 render 在轨迹之后绘制） ---- */
    const mcx = rect.x + rect.w / 2, mcy = rect.y + rect.h / 2;
    const pickable = buildings.filter(b =>
      b.w > 14 && b.h > 9 &&
      b.x > rect.x + 10 && b.x + b.w < rect.x + rect.w - 10 &&
      b.y > rect.y + 10 && b.y + b.h < rect.y + rect.h - 10
    );
    pickable.sort((a, b) => {
      const da = Math.hypot(a.x + a.w / 2 - mcx, a.y + a.h / 2 - mcy);
      const db = Math.hypot(b.x + b.w / 2 - mcx, b.y + b.h / 2 - mcy);
      return da - db;
    });
    rng.shuffle(pickable.slice(0, 14)).slice(0, 4).forEach(b => {
      const lx = b.x + b.w / 2, ly = b.y + b.h / 2;
      if (view.labels.some(l => Math.abs(l.y - ly) < 11 && Math.abs(l.x - lx) < 62)) return;
      view.labels.push({ text: rng.int(3, 26) + '号楼', x: lx, y: ly, size: 8, color: '#a6a5a1', align: 'center' });
    });

    ctx.restore();
  }

  global.ProceduralMap = { draw };
})(window);
