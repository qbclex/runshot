/* 真实瓦片底图（Carto 浅色 / OSM 兜底），跨域失败或超时自动降级到离线底图 */
(function (global) {
  'use strict';

  const PRESETS = [
    { id: 'aosen', name: '奥森公园 · 北京', lat: 40.0175, lon: 116.3878 },
    { id: 'xihu', name: '西湖 · 杭州', lat: 30.2430, lon: 120.1500 },
    { id: 'shiji', name: '世纪公园 · 上海', lat: 31.2185, lon: 121.5480 },
    { id: 'shenzhen', name: '深圳湾公园 · 深圳', lat: 22.5110, lon: 113.9480 },
    { id: 'jincheng', name: '锦城湖 · 成都', lat: 30.5730, lon: 104.0550 },
    { id: 'xuanwu', name: '玄武湖 · 南京', lat: 32.0740, lon: 118.7960 }
  ];

  // 电子地图（街道）：高德路网优先——和选点器用的是同一套图，国内每级都有数据、中文标注最全；
  // Esri 街道 / OSM 兜底。实测郑州一带 Esri World Street Map 在 z15~z19 全部返回同一张
  // 「Map data not yet available」灰图，只靠它成品图会退化成网格；OSM 国内又常连不上。
  const PROVIDERS = [
    { id: 'gaode-road', url: 'https://wprd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', attr: '© 高德地图' },
    { id: 'esri-street', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attr: '© Esri' },
    { id: 'osm', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '© OpenStreetMap' }
  ];

  // 卫星影像（Esri World Imagery，免密钥公开服务）
  const SAT_PROVIDERS = [
    { id: 'esri', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '© Esri · Maxar · Earthstar Geographics' }
  ];

  // 高德卫星影像（style=6，同为 Web Mercator 256px 切片）：境内直连快，纯影像无注记。
  // 返回 ACAO:*（已实测），画布不被污染，能正常导出成品图。
  // maxZ=18：境内多数区域到 z18 为止，再往上会返回固定的中灰「无影像」图（实测郑州 z19
  // 整张 mean≈131/std≈0.6），所以层级封顶后放大使用，而不是让它触发兜底。
  // 境外无覆盖时同样返回中灰图，由 looksLikePlaceholder 识别后落到末尾的 Esri 影像。
  const GAODE_SAT = [
    { id: 'gaode', url: 'https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}', attr: '© 高德地图', maxZ: 18 },
    { id: 'esri', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '© Esri · Maxar · Earthstar Geographics' }
  ];

  // Google 卫星影像（lyrs=s，Web Mercator 切片）。Google 瓦片服务器通常不带 CORS 头，
  // 故 loadTile 对 google 域名不设 crossOrigin。国内直连不了时末尾 Esri 影像自动兜底。
  const GOOGLE_SAT = [
    { id: 'google0', url: 'https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', attr: '© Google' },
    { id: 'google1', url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', attr: '© Google' },
    { id: 'google2', url: 'https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', attr: '© Google' },
    { id: 'google3', url: 'https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', attr: '© Google' },
    { id: 'esri', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '© Esri · Maxar · Earthstar Geographics' }
  ];

  const cache = new Map();
  let disabled = false;

  function mppAt(z, lat) {
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
  }

  // 「没有数据」时有些源不报错，而是回一张合法的占位图（HTTP 200、能 onload），
  // 于是既不会触发 onerror、也不会触发兜底源，成品图里就是一片灰/白块。识别特征：
  //   Esri 超出覆盖层级 → 浅灰「Map data not yet available」（郑州 z15~z19 都是同一张）；
  //   高德卫星境外/超层级 → 固定的中灰图（亮度约 132，比 Esri 那张暗得多）；
  //   高德路网境外         → 整张纯白（亮度约 249，标准差 ~0）。
  // 真实影像/路网的亮度标准差都远大于阈值，不会误判。Google 不设 crossOrigin，
  // 读像素会抛 SecurityError，这里 catch 后按「不是占位图」放行即可。
  function looksLikePlaceholder(url, img) {
    const isEsri = url.indexOf('arcgisonline.com') >= 0;
    const isGaode = url.indexOf('is.autonavi.com') >= 0;
    const isGaodeSat = isGaode && url.indexOf('style=6') >= 0;
    const isGaodeRoad = isGaode && url.indexOf('style=7') >= 0;
    if (!isEsri && !isGaodeSat && !isGaodeRoad) return false;
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
      if (isEsri) return std < 8 && mean > 200 && mean < 250;
      if (isGaodeSat) return std < 12 && mean > 90 && mean < 200;
      return std < 6 && mean > 238;
    } catch (e) { return false; }
  }

  function loadTile(provider, z, x, y) {
    const key = provider.id + '/' + z + '/' + x + '/' + y;
    if (cache.has(key)) return cache.get(key);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      const url = provider.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; cache.delete(key); reject(new Error('timeout')); } }, 8000);
      // 本文件负责导出成品图，画布绝不能被污染：canvas.toBlob() 在 tainted 状态下返回 null，
      // toDataURL() 直接抛 SecurityError，用户点下载只会看到「导出失败」。
      // 规则：凡返回 ACAO 头的源（Esri / 高德 / OSM，已 curl 实测）一律 anonymous；
      //       Google 不返回 CORS 头，只能 null——所以 Google 影像模式导出不可用。
      img.crossOrigin = (url.indexOf('google.com') >= 0) ? null : 'anonymous';
      img.onload = () => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (looksLikePlaceholder(url, img)) { cache.delete(key); reject(new Error('placeholder')); }
        else resolve(img);
      };
      img.onerror = () => { if (!done) { done = true; clearTimeout(timer); cache.delete(key); reject(new Error('tile-error')); } };
      img.src = url;
    });
    cache.set(key, p);
    return p;
  }

  async function drawWith(ctx, view, record, opts, provider) {
    // 手绘轨迹：以轨迹质心为瓦片中心；预设地点：用该地点经纬度
    const preset = (record.routeKind === 'userdraw' && record.route.origin)
      ? { lat: record.route.origin.lat, lon: record.route.origin.lon }
      : (PRESETS.find(p => p.id === record.location) || PRESETS[0]);
    const S = (opts && opts.scale) || 1;
    const rect = view.rect;
    const targetMpp = 1 / (view.scale * S); // 设备像素 / 米

    let z = 3;
    const zMax = provider.maxZ || 19;
    while (z < zMax && mppAt(z, preset.lat) > targetMpp) z++;
    const mppz = mppAt(z, preset.lat);

    const M = Math.PI / 180;
    const lat = preset.lat - view.cy / 111320;
    const lon = preset.lon + view.cx / (111320 * Math.cos(lat * M));
    const n = 256 * Math.pow(2, z);
    const wx = (lon + 180) / 360 * n;
    const wy = (1 - Math.log(Math.tan(lat * M) + 1 / Math.cos(lat * M)) / Math.PI) / 2 * n;

    const k = 1 / (mppz * view.scale); // 逻辑像素 -> 瓦片像素
    const wpx0 = wx - (rect.w / 2) * k;
    const wpy0 = wy - (rect.h / 2) * k;
    const tiles = n / 256;
    const tx0 = Math.floor(wpx0 / 256) - 1, tx1 = Math.floor((wpx0 + rect.w * k) / 256) + 1;
    const ty0 = Math.floor(wpy0 / 256) - 1, ty1 = Math.floor((wpy0 + rect.h * k) / 256) + 1;

    const jobs = [];
    for (let tx = tx0; tx <= tx1 && jobs.length < 64; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (ty < 0 || ty >= tiles) continue;
        const wrapped = ((tx % tiles) + tiles) % tiles;
        jobs.push({ tx, ty, promise: loadTile(provider, z, wrapped, ty) });
      }
    }
    if (!jobs.length) return false;

    // 先垫一层接近底图色调的底色，个别瓦片失败时也不会露出白斑
    ctx.save();
    ctx.fillStyle = 'rgba(225,228,220,1)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();

    // 部分瓦片失败不放弃整图：画上成功的那些即可（失败的不缓存，下次可重试）
    let imgs;
    try {
      const rs = await Promise.allSettled(jobs.map(j => j.promise));
      imgs = rs.map(r => (r.status === 'fulfilled' ? r.value : null));
    } catch (e) {
      return false;
    }

    const size = 256 / k;
    let drawn = 0;
    try {
      for (let i = 0; i < jobs.length; i++) {
        if (!imgs[i]) continue;
        const j = jobs[i];
        ctx.drawImage(imgs[i], rect.x + (j.tx * 256 - wpx0) / k, rect.y + (j.ty * 256 - wpy0) / k, size, size);
        drawn++;
      }
    } catch (e) {
      return false;
    }
    if (drawn < Math.max(4, jobs.length * 0.5)) return false;

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.font = '6px "SF Pro Display",Arial,sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.textAlign = 'right';
    ctx.fillText(provider.attr, rect.x + rect.w - 4, rect.y + rect.h - 4);
    ctx.restore();
    return true;
  }

  async function draw(ctx, view, record, opts) {
    if (disabled) return false;
    const list = (opts && opts.mapMode === 'satellite') ? SAT_PROVIDERS
      : (opts && opts.mapMode === 'gaodesat') ? GAODE_SAT
      : (opts && opts.mapMode === 'googlesat') ? GOOGLE_SAT
      : PROVIDERS;
    for (let i = 0; i < list.length; i++) {
      const ok = await drawWith(ctx, view, record, opts, list[i]);
      if (ok) return true;
    }
    disabled = true; // 本次会话不再重试，避免断网时每张都等超时
    return false;
  }

  function reset() { disabled = false; }

  global.TileMap = { draw, reset, PRESETS, PROVIDERS, SAT_PROVIDERS };
})(window);
