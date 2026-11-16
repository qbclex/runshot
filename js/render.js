/* 整屏渲染：360×800 逻辑像素（导出 ×3 = 1080×2400） */
(function (global) {
  'use strict';

  const W = 360, H = 800;
  const MAP_Y = 204, MAP_H = 240;

  // 需要走真实瓦片的模式；procedural 不在其中（直接画离线底图）。
  // 用集合而不是逐个 === 比较，避免新增模式（如 googlesat / gaodesat）时漏判导致静默退回离线图。
  const TILE_MODES = { tiles: 1, auto: 1, satellite: 1, gaodesat: 1, googlesat: 1 };

  const F = '"SF Pro Display","PingFang SC","HarmonyOS Sans","Microsoft YaHei","Helvetica Neue",Arial,sans-serif';
  const FN = '"DIN Alternate","SF Pro Display","PingFang SC","Helvetica Neue",Arial,sans-serif';

  const C = {
    bg: '#ffffff',
    ink: '#111214',
    sub: '#9b9b9b',
    hair: '#f0f0f0',
    green: '#2bd47e',
    route: '#79d8a8'
  };

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    const rad = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.arcTo(x + w, y, x + w, y + rad, rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
    ctx.lineTo(x + rad, y + h);
    ctx.arcTo(x, y + h, x, y + h - rad, rad);
    ctx.lineTo(x, y + rad);
    ctx.arcTo(x, y, x + rad, y, rad);
    ctx.closePath();
  }

  function setFont(ctx, weight, size, family) {
    ctx.font = weight + ' ' + size + 'px ' + (family || F);
  }

  function buildView(record, rect) {
    const b = record.route.bbox;
    let bw = Math.max(1, b.maxX - b.minX);
    let bh = Math.max(1, b.maxY - b.minY);
    // 跑道模板：把跑道面（含分道）一起纳入取景，避免红色跑道被裁
    if (record.routeKind === 'track' && record.route.track) {
      bw = record.route.track.halfL * 2 + 96;
      bh = 96;
    }
    // 手绘轨迹：走通用 bbox 适配（质心在原点的米坐标）
    const padX = 30, padY = 24;
    const scale = Math.min((rect.w - padX * 2) / bw, (rect.h - padY * 2) / bh);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    return {
      rect, scale, cx, cy, tilt: 0,
      X: m => rect.x + rect.w / 2 + (m - cx) * scale,
      Y: m => rect.y + rect.h / 2 + (m - cy) * scale
    };
  }

  function drawRoute(ctx, view, record) {
    const pts = record.route.points;
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(view.X(pts[0][0]), view.Y(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(view.X(pts[i][0]), view.Y(pts[i][1]));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 7.4;
    ctx.stroke();
    ctx.strokeStyle = C.route;
    ctx.lineWidth = 4.6;
    ctx.stroke();

    const s = pts[0], e = pts[pts.length - 1];
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(view.X(s[0]), view.Y(s[1]), 4.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#4ecf95';
    ctx.arc(view.X(s[0]), view.Y(s[1]), 3.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(view.X(e[0]), view.Y(e[1]), 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#f0918f';
    ctx.arc(view.X(e[0]), view.Y(e[1]), 3.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* 手绘轨迹瓦片失败时的中性底图（不伪造街区，只留浅网格） */
  function drawUserFallback(ctx, view) {
    const r = view.rect;
    ctx.fillStyle = '#e8ebe6';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    for (let x = r.x + 14; x < r.x + r.w; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
      ctx.stroke();
    }
    for (let y = r.y + 14; y < r.y + r.h; y += 28) {
      ctx.beginPath();
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
      ctx.stroke();
    }
  }

  function drawMapLabels(ctx, view) {
    if (!view.labels || !view.labels.length) return;
    const t = view.tilt || 0;
    const mx = view.rect.x + view.rect.w / 2, my = view.rect.y + view.rect.h / 2;
    const ct = Math.cos(t), st = Math.sin(t);
    const px = (x, y) => t ? [mx + (x - mx) * ct - (y - my) * st, my + (x - mx) * st + (y - my) * ct] : [x, y];
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    view.labels.forEach(l => {
      const p = px(l.x, l.y);
      ctx.textAlign = l.align || 'center';
      setFont(ctx, 400, l.size);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeText(l.text, p[0], p[1]);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, p[0], p[1]);
    });
    ctx.restore();
  }

  /* ---------------- 整屏 ---------------- */

  async function render(record, opts) {
    opts = opts || {};
    const S = opts.scale || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * S);
    canvas.height = Math.round(H * S);
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    /* 地图 */
    const view = buildView(record, { x: 0, y: MAP_Y, w: W, h: MAP_H });
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, MAP_Y, W, MAP_H);
    ctx.clip();
    if (view.tilt) {
      const mx = view.rect.x + view.rect.w / 2, my = view.rect.y + view.rect.h / 2;
      ctx.translate(mx, my);
      ctx.rotate(view.tilt);
      ctx.translate(-mx, -my);
    }
    let ok = false;
    if (TILE_MODES[opts.mapMode]) {
      try { ok = await global.TileMap.draw(ctx, view, record, opts); } catch (e) { ok = false; }
    }
    if (!ok) {
      if (record.routeKind === 'userdraw') drawUserFallback(ctx, view);
      else global.ProceduralMap.draw(ctx, view, record);
    }
    drawRoute(ctx, view, record);
    ctx.restore();
    drawMapLabels(ctx, view);

    /* 地图右侧悬浮按钮 */
    drawMapButtons(ctx);

    /* 状态栏 */
    if (opts.statusBar !== false) drawStatusBar(ctx, record);

    /* 导航栏 */
    if (opts.chrome !== false) drawNav(ctx);

    /* 标题 + 日期 + 距离 + 标签 */
    drawTitle(ctx, record);
    drawHero(ctx, record);
    drawTag(ctx, record);

    /* 数据区 */
    ctx.fillStyle = C.hair;
    ctx.fillRect(0, 446, W, 1);
    drawData(ctx, record);

    /* 运动趋势（底部被裁切） */
    drawTrend(ctx);
    if (opts.cta !== false) drawCta(ctx);

    /* Home 指示条 */
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    rr(ctx, 126, 786, 108, 4, 2);
    ctx.fill();

    return canvas;
  }

  function drawMapButtons(ctx) {
    const items = [
      { y: 216, label: '皮肤', icon: 'skin' },
      { y: 266, label: '视频', icon: 'video' }
    ];
    items.forEach(it => {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.09)';
      ctx.shadowBlur = 7;
      ctx.shadowOffsetY = 1.5;
      ctx.fillStyle = '#ffffff';
      rr(ctx, 316, it.y, 33, 43, 7);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.055)';
      ctx.lineWidth = 0.8;
      rr(ctx, 316, it.y, 33, 43, 7);
      ctx.stroke();

      const cx = 332.5, cy = it.y + 15;
      ctx.save();
      ctx.strokeStyle = '#2b2b2b';
      ctx.fillStyle = '#2b2b2b';
      ctx.lineWidth = 1.3;
      ctx.lineJoin = 'round';
      if (it.icon === 'skin') {
        ctx.beginPath();
        ctx.rect(cx - 7, cy - 7, 14, 14);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy + 5);
        ctx.lineTo(cx - 2, cy - 1);
        ctx.lineTo(cx + 1, cy + 3);
        ctx.lineTo(cx + 3, cy + 1);
        ctx.lineTo(cx + 6, cy + 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + 2.5, cy - 3.5, 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 2, cy - 3.6);
        ctx.lineTo(cx + 3.6, cy);
        ctx.lineTo(cx - 2, cy + 3.6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#6a6a6a';
      setFont(ctx, 400, 7.6);
      ctx.fillText(it.label, cx, it.y + 35);
      ctx.textAlign = 'left';
    });
  }

  function drawStatusBar(ctx, record) {
    ctx.fillStyle = C.ink;
    setFont(ctx, 600, 12.5);
    ctx.fillText(record.finishText, 18, 26);

    const st = record.status || { bars: 4, net: '5G', speed: '2.9 K/s', battery: 62 };

    // 信号：4 格，实心格数随机
    const bx = 232;
    for (let i = 0; i < 4; i++) {
      const h = 3 + i * 2.6;
      ctx.fillStyle = i < st.bars ? C.ink : 'rgba(17,18,20,0.24)';
      rr(ctx, bx + i * 4.6, 22 - h, 2.8, h, 0.8);
      ctx.fill();
    }
    setFont(ctx, 600, 8.5);
    ctx.fillStyle = C.ink;
    ctx.fillText(st.net, 252, 22);
    setFont(ctx, 400, 7.6);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillText(st.speed, 266, 22);

    // 电量
    setFont(ctx, 500, 9.2);
    ctx.fillStyle = st.battery <= 20 ? '#d9534f' : C.ink;
    ctx.textAlign = 'right';
    ctx.fillText(String(st.battery), 314, 21);
    ctx.textAlign = 'left';

    ctx.strokeStyle = st.battery <= 20 ? 'rgba(217,83,79,0.55)' : C.ink;
    ctx.lineWidth = 1.1;
    rr(ctx, 318, 12.6, 18, 9, 2.4);
    ctx.stroke();
    ctx.fillStyle = st.battery <= 20 ? '#d9534f' : C.ink;
    const inner = Math.max(1.2, 14.8 * st.battery / 100);
    rr(ctx, 319.6, 14.2, inner, 5.8, 1);
    ctx.fill();
    rr(ctx, 336.4, 15.4, 2, 3.4, 0.8);
    ctx.fill();
  }

  function drawNav(ctx) {
    // 返回
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(24, 51);
    ctx.lineTo(16.5, 58.5);
    ctx.lineTo(24, 66);
    ctx.stroke();

    // 隐私胶囊
    ctx.fillStyle = '#f4f4f4';
    rr(ctx, 212, 46, 51, 25, 12.5);
    ctx.fill();
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1.1;
    rr(ctx, 221, 53.5, 8, 8, 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(225, 53.5, 2.6, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#333';
    setFont(ctx, 500, 11);
    ctx.fillText('隐私', 233, 63.5);

    // 分享
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(280, 64.5);
    ctx.lineTo(280, 69.5);
    ctx.lineTo(295, 69.5);
    ctx.lineTo(295, 64.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(287.5, 66);
    ctx.lineTo(287.5, 51.5);
    ctx.moveTo(283, 56);
    ctx.lineTo(287.5, 51.5);
    ctx.lineTo(292, 56);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(290, 61);
    ctx.lineTo(295, 61);
    ctx.stroke();

    // 更多
    ctx.fillStyle = C.ink;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(317 + i * 5.4, 59, 1.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRunnerIcon(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = C.ink;
    ctx.fillStyle = C.ink;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(8.4, 2.6, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(9.4, 5.4);
    ctx.lineTo(6.6, 9.4);
    ctx.lineTo(9.6, 12.4);
    ctx.lineTo(7.4, 16.4);
    ctx.moveTo(6.6, 9.4);
    ctx.lineTo(3.2, 11.6);
    ctx.moveTo(7.6, 7.4);
    ctx.lineTo(11.6, 9.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(4.2, 16.6);
    ctx.lineTo(6.6, 15.2);
    ctx.stroke();
    ctx.restore();
  }

  function drawTitle(ctx, record) {
    drawRunnerIcon(ctx, 15, 79);
    ctx.fillStyle = C.ink;
    setFont(ctx, 600, 17);
    ctx.fillText('户外跑步', 36, 96);

    // 日期行（含星期）
    ctx.fillStyle = '#8a8a8a';
    setFont(ctx, 500, 12);
    ctx.fillText(record.dateText, 36, 119);
  }

  function drawHero(ctx, record) {
    const y = 158;
    setFont(ctx, 800, 42, FN);
    try { ctx.letterSpacing = '-1.8px'; } catch (e) { /* noop */ }
    ctx.fillStyle = C.ink;
    ctx.fillText(record.distanceText, 16, y);
    const w = ctx.measureText(record.distanceText).width;
    try { ctx.letterSpacing = '0px'; } catch (e) { /* noop */ }
    setFont(ctx, 500, 13);
    ctx.fillText('公里', 16 + w + 7, y - 1);
  }

  function drawTag(ctx, record) {
    // 「自定义地图」只是 routeName 的占位文案，不是用户填的标签，画在成品上像残留的界面角标
    if (!record.tag || record.tag === '自定义地图') return;
    const y = 181;
    ctx.fillStyle = '#ff9f34';
    rr(ctx, 16, y, 15, 15, 4.2);
    ctx.fill();
    // 小自行车轮廓
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.arc(20.3, y + 9.7, 2.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(26.5, y + 9.7, 2.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(20.3, y + 9.7);
    ctx.lineTo(23.0, y + 5.2);
    ctx.lineTo(26.5, y + 9.7);
    ctx.moveTo(23.0, y + 5.2);
    ctx.lineTo(25.6, y + 5.2);
    ctx.stroke();
    ctx.fillStyle = '#222';
    setFont(ctx, 500, 12.5);
    ctx.fillText(record.tag, 37, y + 12.4);
  }

  function drawData(ctx, record) {
    ctx.fillStyle = C.ink;
    setFont(ctx, 700, 17);
    ctx.fillText('运动数据', 16, 481);

    ctx.fillStyle = '#f4f4f4';
    rr(ctx, 286, 462, 58, 23, 11.5);
    ctx.fill();
    ctx.fillStyle = '#555';
    setFont(ctx, 500, 10.5);
    ctx.textAlign = 'center';
    ctx.fillText('查看详情', 315, 477.5);
    ctx.textAlign = 'left';

    const cols = [18, 124, 232];
    const rows = [
      [['训练时长', record.durText, ''], ['平均配速', record.paceText, ''], ['运动消耗', String(record.kcal), '千卡']],
      [['总时长', record.totalText, ''], ['运动负荷', String(record.load), ''], ['平均心率', String(record.hr), '次/分']],
      [['爬升高度', String(record.elev), '米'], ['平均步频', String(record.cadence), ''], ['平均功率', String(record.power), '瓦']]
    ];

    rows.forEach((row, ri) => {
      const yLabel = 510 + ri * 41;
      const yVal = yLabel + 21;
      row.forEach((cell, ci) => {
        const x = cols[ci];
        ctx.fillStyle = C.sub;
        setFont(ctx, 400, 11.5);
        ctx.fillText(cell[0], x, yLabel);
        ctx.fillStyle = C.ink;
        setFont(ctx, 700, 21, FN);
        ctx.fillText(cell[1], x, yVal);
        if (cell[2]) {
          const w = ctx.measureText(cell[1]).width;
          setFont(ctx, 400, 11);
          ctx.fillStyle = '#4a4a4a';
          ctx.fillText(cell[2], x + w + 4, yVal);
        }
      });
    });
  }

  function drawTrend(ctx) {
    // 柱状图（被屏幕底部裁切）
    const bars = [26, 40, 30, 52, 44, 66, 34];
    for (let i = 0; i < bars.length; i++) {
      const x = 16 + i * 47;
      const h = bars[i];
      ctx.fillStyle = i === 5 ? '#d6f2e4' : '#f3f3f3';
      rr(ctx, x, 752, 34, h, 4);
      ctx.fill();
    }

    ctx.fillStyle = C.ink;
    setFont(ctx, 700, 15);
    ctx.fillText('运动趋势', 16, 731);
    const w = ctx.measureText('运动趋势').width;

    ctx.fillStyle = '#f8e7c8';
    rr(ctx, 16 + w + 7, 719, 30, 14, 3);
    ctx.fill();
    ctx.fillStyle = '#a3762b';
    setFont(ctx, 500, 8.5);
    ctx.textAlign = 'center';
    ctx.fillText('会员', 16 + w + 22, 729);
    ctx.textAlign = 'left';

    ctx.fillStyle = C.sub;
    setFont(ctx, 400, 11);
    ctx.textAlign = 'right';
    ctx.fillText('查看详情', 344, 731);
    ctx.textAlign = 'left';
  }

  function drawCta(ctx) {
    ctx.save();
    ctx.shadowColor = 'rgba(43,212,126,0.32)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = C.green;
    rr(ctx, 30, 672, 300, 44, 22);
    ctx.fill();
    ctx.restore();

    const label = '发布到社区动态';
    setFont(ctx, 600, 15);
    const tw = ctx.measureText(label).width;
    const total = 17 + 7 + tw;
    const startX = 180 - total / 2;

    // 纸飞机
    ctx.save();
    ctx.translate(startX, 686);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(1.5, 6.5);
    ctx.lineTo(15.5, 0.8);
    ctx.lineTo(11.4, 15.2);
    ctx.lineTo(8.2, 9.6);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(8.2, 9.6);
    ctx.lineTo(15.5, 0.8);
    ctx.lineTo(9.4, 12.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#fff';
    setFont(ctx, 600, 15);
    ctx.fillText(label, startX + 24, 701);
  }

  global.Render = { render, W, H, MAP_Y, MAP_H };
})(window);
