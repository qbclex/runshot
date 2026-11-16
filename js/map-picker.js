/* 自定义地图选点器：电子中国地图上找位置 + 沿跑步路线手绘轨迹
   底图（免密钥公开瓦片服务）：
     卫星 = Esri World Imagery / 高德卫星影像；电子(街道) = 高德路网图优先 + Esri 街道图 / OSM 兜底。
   国内地点优先高德（可直连；路网层的中文注记最全），全球覆盖与兜底交给 Esri。 */
(function (global) {
  'use strict';

  let W = 340, H = 260;       // 逻辑尺寸：随画布显示尺寸动态更新（见 resize()）
  const MIN_DRAW_M = 40;      // 轨迹最短长度（米），低于此视为无效

  const PROVIDERS = {
    // 卫星影像：Esri World Imagery（免密钥公开服务，国内可直连，速度快）
    satellite: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    // 电子（街道）图：高德路网图优先（国内直连、中文标注最详细），Esri 街道图 + OSM 兜底。
    // 高德公开瓦片接口 is.autonavi.com/appmaptile 免 key 可用且返回 ACAO:*（已实测），
    // 故按 loadTile 的规则走 crossOrigin='anonymous'，画布不被污染、可正常导出。
    street: [
      'https://wprd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
    ],
    // 高德卫星影像（style=6）：同样是 Web Mercator 256px 切片，境内直连快、层级够深。
    // 境外没有覆盖：返回的是一张固定的中灰「无影像」图（不同 x/y/z 字节完全相同，已实测
    // mean≈132 / std≈1.5），HTTP 仍是 200，所以靠 looksLikePlaceholder 识别后落到 Esri。
    gaode: [
      'https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    ],
    // Google 卫星影像：与 Esri/OSM 同为 Web Mercator 切片（256px, z/x/y）。
    // 注意：① Google 不返回 CORS 头，loadTile 仅对 google 域名设 crossOrigin=null
    //        （设 anonymous 会导致图片根本加载不出来）；代价是 Google 模式画布被污染、
    //        无法导出成品图，需要导出时请改用「卫星（Esri）」「卫星（高德）」或「电子地图」；
    //      ② 国内网络通常直连不了 mt.google.com，故末尾追加 Esri 影像作兜底——
    //         Google 可达时用 Google，不可达时自动回退到 Esri（可配 VPN 走 Google）。
    google: [
      'https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      'https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      'https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    ]
  };

  const st = {
    lat: 35.0, lon: 105.0, z: 4,   // 初始：全中国视野
    base: 'satellite',
    mode: 'move',                   // move | draw | cal
    strokes: [],                    // 每段：[[lat,lon],...]
    cur: null,                      // 正在画的这一段
    calPts: [],                     // 校准点：沿真实跑道点下的锚点
    cursor: null                    // 悬停位置（逻辑像素）：画准星用
  };

  const cache = new Map();
  let cv = null, ctx = null, dpr =1, onChangeCb = null, drawEpoch = 0;
  let frame = null, frameView = null;   // 上一次成功渲染的整图快照（含底图+叠加层），用于平移/缩放过渡时先显示旧图，避免白屏

  /* ---------------- 瓦片 ---------------- */

  // 有些源在「没有数据」时不报错，而是返回一张合法的占位图（HTTP 200、能 onload），
  // 于是既不会触发 onerror、也不会触发兜底源。这里按源各自的特征识别，识别到就当作
  // 失败处理，让下一源有机会补上真实瓦片：
  //   Esri 超出覆盖层级 → 浅灰「Map data not yet available」（近乎纯色的浅灰）；
  //   高德卫星境外区域   → 固定的中灰图（亮度约 132，比 Esri 那张暗得多）。
  // 真实影像/路网的亮度标准差都远大于阈值，不会误判。
  function looksLikePlaceholder(url, img) {
    const isEsri = url.indexOf('arcgisonline.com') >= 0;
    const isGaodeSat = url.indexOf('is.autonavi.com') >= 0 && url.indexOf('style=6') >= 0;
    if (!isEsri && !isGaodeSat) return false;
    try {
      const S = 8;
      const c = document.createElement('canvas');
      c.width = S; c.height = S;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, S, S);
      const d = x.getImageData(0, 0, S, S).data;
      let sum = 0; const ls = [];
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        ls.push(l); sum += l;
      }
      const mean = sum / ls.length;
      let v = 0;
      for (const l of ls) v += (l - mean) * (l - mean);
      const std = Math.sqrt(v / ls.length);
      return isEsri ? (std < 8 && mean > 200 && mean < 250)
                    : (std < 12 && mean > 90 && mean < 200);
    } catch (e) { return false; }
  }

  function loadTile(url) {
    if (cache.has(url)) return cache.get(url);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; cache.delete(url); reject(new Error('timeout')); } }, 4500);
      // crossOrigin 取值的依据是「该源是否返回 Access-Control-Allow-Origin」：
      //   Esri / 高德 / OSM 均返回 ACAO:*（已 curl 实测），必须设 anonymous——
      //     ① 占位图识别要读像素，污染画布会直接抛 SecurityError；
      //     ② 若不设 anonymous，跨域图片会把画布标记为 tainted，
      //        导出时 canvas.toBlob() 返回 null、toDataURL() 抛错，成品图必然下载失败。
      //   Google 不返回 CORS 头，设 anonymous 会被浏览器整个拦截（连图都加载不出来），
      //   只能保持 null —— 因此 Google 模式下导出不受支持（预览可见，导出会失败）。
      img.crossOrigin = (url.indexOf('google.com') >= 0) ? null : 'anonymous';
      img.onload = () => {
        if (!done) {
          done = true; clearTimeout(timer);
          // 占位图伪装成成功：识别后当作失败，触发下一源兜底
          if (looksLikePlaceholder(url, img)) {
            cache.delete(url);
            reject(new Error('placeholder'));
          } else {
            resolve(img);
          }
        }
      };
      img.onerror = () => { if (!done) { done = true; clearTimeout(timer); cache.delete(url); reject(new Error('err')); } };
      img.src = url;
    });
    cache.set(url, p);
    return p;
  }

  /* ---------------- Web Mercator ---------------- */

  function n2() { return 256 * Math.pow(2, st.z); }
  function lon2wx(lon, n) { return (lon + 180) / 360 * n; }
  function lat2wy(lat, n) {
    const m = Math.PI / 180, s = Math.sin(lat * m);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  }
  function wx2lon(wx, n) { return wx / n * 360 - 180; }
  function wy2lat(wy, n) {
    return (2 * Math.atan(Math.exp((0.5 - wy / n) * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI;
  }
  function ptScreen(p) { // p = [lat, lon]
    const n = n2();
    return [W / 2 + lon2wx(p[1], n) - lon2wx(st.lon, n), H / 2 + lat2wy(p[0], n) - lat2wy(st.lat, n)];
  }
  function screenGeo(px, py) {
    const n = n2();
    return [
      wy2lat(lat2wy(st.lat, n) + (py - H / 2), n),
      wx2lon(lon2wx(st.lon, n) + (px - W / 2), n)
    ];
  }

  /* ---------------- 测距 ---------------- */

  function strokeLenM(pts) {
    if (!pts || pts.length < 2) return 0;
    const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 111320;
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot((pts[i][1] - pts[i - 1][1]) * kx, (lat0 - pts[i][0] + pts[i - 1][0] - lat0) * ky);
    }
    return len;
  }
  function trackKm() {
    let s = 0;
    st.strokes.forEach(k => { s += strokeLenM(k); });
    if (st.cur && st.cur.length > 1) s += strokeLenM(st.cur);
    const cal = calLoop();
    if (cal) s = strokeLenM(cal);   // 有校准点时，以拟合环长度为准
    return s / 1000;
  }

  /* ---------------- 校准点拟合 ---------------- */

  /* 闭合 Catmull-Rom 样条：把用户沿跑道点下的锚点串成平滑闭环（保持锚点的朝向与形状） */
  function calLoop() {
    const P = st.calPts;
    if (!P || P.length < 3) return null;
    const n = P.length, out = [], STEPS = 16;
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      for (let s = 0; s < STEPS; s++) {
        const t = s / STEPS, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push([out[0][0], out[0][1]]);   // 闭合
    return out;
  }

  /* ---------------- 绘制 ---------------- */

  // 把当前画布像素拷成“整图快照”，并记录其视角，供平移/缩放过渡时先显示旧图（避免白屏）
  function snapshot() {
    if (!frame) frame = document.createElement('canvas');
    if (frame.width !== cv.width || frame.height !== cv.height) {
      frame.width = cv.width; frame.height = cv.height;
    }
    frame.getContext('2d').drawImage(cv, 0, 0);
    frameView = { lat: st.lat, lon: st.lon, z: st.z, W: W, H: H };
  }

  function draw() {
    if (!ctx) return;
    syncSize();                  // 绘制前同步当前 CSS 尺寸
    const epoch = ++drawEpoch;   // 新绘制覆盖旧绘制：过期瓦片结果直接丢弃
    const tiles = Math.pow(2, st.z);
    const urls = PROVIDERS[st.base] || PROVIDERS.satellite;
    const jobs = [];
    {
      const n = n2();
      const wxc = lon2wx(st.lon, n), wyc = lat2wy(st.lat, n);
      const x0 = Math.floor((wxc - W / 2) / 256), x1 = Math.floor((wxc + W / 2) / 256);
      const y0 = Math.floor((wyc - H / 2) / 256), y1 = Math.floor((wyc + H / 2) / 256);
      for (let tx = x0; tx <= x1; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          if (ty < 0 || ty >= tiles) continue;
          const wrapped = ((tx % tiles) + tiles) % tiles;
          // 依次尝试各源：任一成功即用（按 URL 缓存，失败不缓存）
          let p = Promise.reject(new Error('start'));
          for (const u of urls) {
            const url = u.replace('{z}', st.z).replace('{x}', wrapped).replace('{y}', ty);
            p = p.catch(() => loadTile(url));
          }
          jobs.push({ tx, ty, p });
        }
      }
    }

    // 每次渲染（含瓦片到达的那次）都先重新同步尺寸，避免画布缩放/移动后
    // backing 尺寸与 CSS 不一致，导致轨迹、准星整体偏移
    const doRender = (rs) => {
      if (!ctx || epoch !== drawEpoch) return;
      syncSize();
      const n = n2();
      const wxc = lon2wx(st.lon, n), wyc = lat2wy(st.lat, n);
      let ok = 0, placeholders = 0;
      ctx.save();
      ctx.scale(dpr, dpr);
      // 先铺“上一次成功渲染的整图”，按当前视角做平移/缩放变换：平移缩放瞬间不再白屏
      if (frame && frameView) {
        const k = Math.pow(2, st.z - frameView.z);          // 新旧层级间的屏幕比例尺
        const c = ptScreen([frameView.lat, frameView.lon]);  // 旧中心在当前视图里的屏幕位置
        const dw = frameView.W * k, dh = frameView.H * k;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(frame, c[0] - dw / 2, c[1] - dh / 2, dw, dh);
      } else {
        ctx.fillStyle = '#dfe4dd';
        ctx.fillRect(0, 0, W, H);
      }
      if (rs) {
        rs.forEach((r, i) => {
          if (r.status !== 'fulfilled') {
            if (r.reason && r.reason.message === 'placeholder') placeholders++;
            return;
          }
          ok++;
          const j = jobs[i];
          try { ctx.drawImage(r.value, W / 2 + (j.tx * 256 - wxc), H / 2 + (j.ty * 256 - wyc), 256, 256); } catch (e) { /* noop */ }
        });
        if (!ok) {
          // 区分两种失败：占位回退后仍无数据（该层级本就无图）vs 纯网络故障
          const msg = placeholders > 0
            ? '该区域此缩放级别暂无地图数据\n请缩小，或切换到“卫星”底图'
            : '地图加载失败（需要联网）';
          ctx.fillStyle = 'rgba(70,74,70,0.62)';
          ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
          ctx.textAlign = 'center';
          const lines = msg.split('\n');
          const lh = 17;
          const y0 = H / 2 - (lines.length - 1) * lh / 2;
          lines.forEach((t, k) => ctx.fillText(t, W / 2, y0 + k * lh));
          ctx.textAlign = 'left';
        }
      }
      drawOverlays();
      if (ok > 0) snapshot();     // 仅在有瓦片成功时刷新缓存帧；失败则保留旧帧
      ctx.restore();
    };

    doRender(null);             // 立即用上一次整图（或底色）给视觉反馈，瓦片到达前不白屏
    Promise.allSettled(jobs.map(j => j.p)).then(doRender);
  }

  function drawStroke(pts) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    const s0 = ptScreen(pts[0]);
    ctx.moveTo(s0[0], s0[1]);
    for (let i = 1; i < pts.length; i++) {
      const s = ptScreen(pts[i]);
      ctx.lineTo(s[0], s[1]);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 4.6;
    ctx.stroke();
    ctx.strokeStyle = '#2bd47e';
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }

  function drawOverlays() {
    st.strokes.forEach(drawStroke);
    if (st.cur && st.cur.length > 1) drawStroke(st.cur);

    // 校准模式：画拟合环（虚线）与锚点
    if (st.calPts.length) {
      const loop = calLoop();
      if (loop) {
        ctx.beginPath();
        const s0 = ptScreen(loop[0]);
        ctx.moveTo(s0[0], s0[1]);
        for (let i = 1; i < loop.length; i++) {
          const s = ptScreen(loop[i]);
          ctx.lineTo(s[0], s[1]);
        }
        ctx.setLineDash([5, 4]);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 4.2;
        ctx.stroke();
        ctx.strokeStyle = '#2bd47e';
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      st.calPts.forEach((p, i) => {
        const s = ptScreen(p);
        ctx.beginPath();
        ctx.fillStyle = '#fff';
        ctx.arc(s[0], s[1], 4.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = '#f2803c';
        ctx.arc(s[0], s[1], 3.0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b35617';
        ctx.font = '8px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), s[0], s[1] - 6);
        ctx.textAlign = 'left';
      });
    }

    // 起点小圆
    const first = st.cur && st.cur.length ? st.cur[0] : (st.strokes.length && st.strokes[0][0]);
    if (first && !st.calPts.length) {
      const s = ptScreen(first);
      ctx.beginPath();
      ctx.fillStyle = '#fff';
      ctx.arc(s[0], s[1], 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = '#2bd47e';
      ctx.arc(s[0], s[1], 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // 缩放级别角标
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    rr2(6, H - 22, 40, 16, 4);
    ctx.fill();
    ctx.fillStyle = '#444';
    ctx.font = '9.5px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('z' + st.z, 14, H - 10.5);
    // 模式边框提示
    if (st.mode === 'draw' || st.mode === 'cal') {
      ctx.strokeStyle = st.mode === 'cal' ? 'rgba(242,128,60,0.9)' : 'rgba(43,212,126,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, W - 2, H - 2);
    }
    // 悬停准星 + 对齐诊断（左上角读数：内部逻辑尺寸应 ≈ CSS 尺寸）
    if (st.cursor) {
      const cx = st.cursor[0], cy = st.cursor[1];
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 13, cy); ctx.lineTo(cx - 5, cy);
      ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 13, cy);
      ctx.moveTo(cx, cy - 13); ctx.lineTo(cx, cy - 5);
      ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 13);
      ctx.stroke();
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // 仅调试模式（URL 含 ?debug）显示对齐自读数，默认保持画面干净
      if (global.location && global.location.search.indexOf('debug') >= 0) {
        const r = cv.getBoundingClientRect();
        const info = '逻辑' + W + '×' + H + ' 显示' + Math.round(r.width) + '×' + Math.round(r.height)
          + ' dpr' + (+dpr.toFixed(2)) + ' 模式' + st.mode;
        ctx.font = '9px Consolas,monospace';
        const tw = ctx.measureText(info).width;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        rr2(6, 6, tw + 12, 16, 4);
        ctx.fill();
        ctx.fillStyle = '#ffd24a';
        ctx.fillText(info, 12, 17);
      }
    }
  }

  function rr2(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- 交互 ---------------- */

  function pan(dx, dy) {
    const n = n2();
    st.lon = wx2lon(lon2wx(st.lon, n) - dx, n);
    st.lat = Math.max(-84, Math.min(84, wy2lat(lat2wy(st.lat, n) - dy, n)));
  }

  function zoomAt(px, py, dz) {
    const z2 = Math.max(3, Math.min(19, st.z + dz));
    if (z2 === st.z) return;
    const geo = screenGeo(px, py);
    st.z = z2;
    const n = n2();
    const wxg = lon2wx(geo[1], n), wyg = lat2wy(geo[0], n);
    st.lon = wx2lon(wxg - (px - W / 2), n);
    st.lat = Math.max(-84, Math.min(84, wy2lat(wyg - (py - H / 2), n)));
  }

  function evPos(e) {
    // 逻辑坐标即画布 CSS 像素偏移：直接用实时 rect 换算，不依赖内部 W/H，
    // 从根本上避免“画布尺寸变化后 W 未及时跟上”导致的鼠标/轨迹错位
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function init(canvas, onChange) {
    cv = canvas;
    onChangeCb = onChange || null;
    dpr = Math.min(2, global.devicePixelRatio || 1);
    ctx = cv.getContext('2d');
    cv.style.touchAction = 'none';
    resize();
    // 画布显示尺寸变化（如进入大图模式）时自动重设分辨率并重绘
    if (global.ResizeObserver) new global.ResizeObserver(resize).observe(cv);
    global.addEventListener('resize', resize);

    let dragging = false, last = null;

    cv.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      const p = evPos(e);
      dragging = true;
      last = p;
      if (st.mode === 'draw') {
        st.cur = [screenGeo(p[0], p[1])];
        draw();
      } else if (st.mode === 'cal') {
        st.calPts.push(screenGeo(p[0], p[1]));
        draw();
        if (onChangeCb) onChangeCb();
      }
    });
    cv.addEventListener('pointermove', e => {
      const p = evPos(e);
      st.cursor = p;                 // 悬停准星：走完整映射管线，用于校验鼠标↔画布对齐
      if (!dragging) { draw(); return; }
      if (st.mode === 'move') {
        pan(p[0] - last[0], p[1] - last[1]);
        last = p;
        draw();
      } else if (st.cur && st.cur.length) {
        const head = ptScreen(st.cur[st.cur.length - 1]);
        if (Math.hypot(p[0] - head[0], p[1] - head[1]) >= 2.5) {
          st.cur.push(screenGeo(p[0], p[1]));
          draw();
        }
      }
    });
    const up = e => {
      if (!dragging) return;
      dragging = false;
      if (st.mode === 'draw' && st.cur) {
        if (st.cur.length >= 4 && strokeLenM(st.cur) >= MIN_DRAW_M) {
          st.strokes.push(st.cur);
          if (onChangeCb) onChangeCb();
        }
        st.cur = null;
        draw();
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (st.cursor) { st.cursor = null; draw(); } });

    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const p = evPos(e);
      zoomAt(p[0], p[1], e.deltaY < 0 ? 1 : -1);
      draw();
    }, { passive: false });

    draw();
  }

  /* 尺寸自适应：以画布“真实 CSS 显示尺寸”为准设置物理分辨率（backing）。
     核心原则：backing 的宽高比必须与真实显示框的宽高比严格一致，
     否则浏览器会把 backing 拉伸/压缩进 CSS 框，造成轨迹、准星纵向（或横向）错位。
     显示尺寸完全交给 CSS 掌控（小图 width:100%+aspect-ratio；大图 width:100%+height:min），
     这里只让 backing 跟随真实显示尺寸，不写内联 width/height——
     写内联会冻结尺寸、破坏“大图模式”的放大与窗口缩放自适应。 */
  function syncSize() {
    if (!cv) return false;
    const r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const nw = Math.round(r.width), nh = Math.round(r.height);
    if (nw === W && nh === H && Math.round(cv.width) === Math.round(nw * dpr) && Math.round(cv.height) === Math.round(nh * dpr)) return false;
    W = nw; H = nh;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    return true;
  }
  function resize() { if (syncSize()) draw(); }

  /* ---------------- 对外 API ---------------- */

  function setCenter(lat, lon, z) {
    st.lat = lat; st.lon = lon;
    if (z) st.z = z;
    draw();
  }
  function setBase(b) {
    if (PROVIDERS[b]) st.base = b;
    draw();
  }
  function setMode(m) {
    if (m === 'move' || m === 'draw' || m === 'cal') st.mode = m;
    if (cv) cv.classList.toggle('draw', st.mode !== 'move');
    draw();
  }
  function undo() {
    if (st.calPts.length) st.calPts.pop();
    else st.strokes.pop();
    draw();
    if (onChangeCb) onChangeCb();
  }
  function clear() {
    st.strokes = [];
    st.cur = null;
    st.calPts = [];
    draw();
    if (onChangeCb) onChangeCb();
  }
  function zoomBy(dz) {
    syncSize();
    zoomAt(W / 2, H / 2, dz);
    draw();
  }
  function get() {
    if (!st.strokes.length) return null;
    let total = 0;
    st.strokes.forEach(k => { total += strokeLenM(k); });
    if (total < MIN_DRAW_M) return null;
    return { strokes: st.strokes.map(k => k.map(p => [+p[0], +p[1]])), base: st.base };
  }

  global.MapPicker = {
    init, draw, resize, setCenter, setBase, setMode, undo, clear, get, trackKm, zoomBy, calLoop,
    calCount: () => st.calPts.length,
    base: () => st.base,
    mode: () => st.mode,
    // 当前视野中心：地名搜索拿它当空间偏向，让「公园」「体育馆」这类短词先出附近的
    center: () => ({ lat: st.lat, lon: st.lon, z: st.z }),
    ready: () => !!ctx,
    size: () => ({ w: W, h: H, bw: cv.width, bh: cv.height, cw: cv.getBoundingClientRect().width, ch: cv.getBoundingClientRect().height })
  };
})(window);
