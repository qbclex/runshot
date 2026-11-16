/* 界面编排：参数读取、批量生成、缩略图网格、单张 / ZIP 导出、自检 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const U = window.U;
  const state = { params: null, records: [], busy: false, cancel: false, current: 0 };

  const WEEKDAY_DEFAULT = [1, 3, 5];
  const MAP_MODE_LABEL = { procedural: '离线底图', auto: '自动底图', tiles: '真实瓦片', satellite: '卫星影像', gaodesat: '高德卫星', googlesat: 'Google 卫星' };

  /* ---------------- 初始化 ---------------- */

  function randomSeed() {
    return Math.random().toString(36).slice(2, 8);
  }

  /* 当前地点是否为「自定义地图」 */
  function isCustomLocation() {
    return $('#location').value === 'custom';
  }

  /* 自定义地图会锁定底图（底图由选点器决定，不让用户再单独选） */
  function syncLocationLock() {
    const customOn = isCustomLocation();

    document.querySelectorAll('#routeChips .chip').forEach(el => {
      if (customOn) el.classList.add('dim');
      else el.classList.remove('dim');
    });
    if (!customOn && !document.querySelector('#routeChips .chip.on')) {
      const first = document.querySelector('#routeChips .chip[data-kind="block"]');
      if (first) first.classList.add('on');
    }

    const mode = $('#mapMode');
    if (customOn) {
      if (!mode.dataset.prev) mode.dataset.prev = mode.value;
      mode.value = window.MapPicker.base() === 'street' ? 'tiles'
        : window.MapPicker.base() === 'google' ? 'googlesat' : 'satellite';
      mode.disabled = true;
    } else {
      mode.disabled = false;
      if (mode.dataset.prev) {
        mode.value = mode.dataset.prev;
        delete mode.dataset.prev;
      }
    }
    $('#customPanel').hidden = !customOn;
    $('#modeBadge').textContent = customOn ? '自定义地图'
      : (MAP_MODE_LABEL[mode.value] || '离线底图');
    window.TileMap.reset();
    if (customOn && window.MapPicker.ready()) setTimeout(() => window.MapPicker.draw(), 0);
  }

  /* ---------------- 自定义地图：电子地图选点 + 手绘轨迹 ---------------- */

  const CITIES = [
    ['北京', 39.904, 116.407], ['上海', 31.230, 121.474], ['广州', 23.129, 113.264],
    ['深圳', 22.543, 114.057], ['成都', 30.572, 104.066], ['武汉', 30.593, 114.305],
    ['西安', 34.341, 108.940], ['郑州', 34.747, 113.625], ['杭州', 30.274, 120.155],
    ['南京', 32.060, 118.797], ['重庆', 29.563, 106.551], ['长沙', 28.228, 112.939],
    ['天津', 39.084, 117.201], ['青岛', 36.067, 120.383], ['厦门', 24.480, 118.089],
    ['沈阳', 41.806, 123.432], ['哈尔滨', 45.803, 126.535], ['长春', 43.880, 125.325],
    ['石家庄', 38.042, 114.515], ['太原', 37.870, 112.549], ['合肥', 31.821, 117.227],
    ['福州', 26.074, 119.297], ['南昌', 28.682, 115.858], ['济南', 36.651, 117.120],
    ['昆明', 24.880, 102.833], ['贵阳', 26.647, 106.630], ['南宁', 22.817, 108.366],
    ['兰州', 36.061, 103.834], ['西宁', 36.617, 101.778], ['银川', 38.487, 106.231],
    ['呼和浩特', 40.842, 111.750], ['乌鲁木齐', 43.826, 87.617], ['拉萨', 29.650, 91.140],
    ['海口', 20.045, 110.199], ['香港', 22.319, 114.169], ['澳门', 22.198, 113.543]
  ];

  /* 热门跑步地点：比城市更小一级（公园 / 校园 / 场馆 / 风光带），直接跳到能看清跑道的缩放级别 */
  const PLACES = [
    ['奥森公园 · 北京', 40.0175, 116.3878, 15],
    ['天坛公园 · 北京', 39.8822, 116.4066, 15],
    ['未名湖 · 北京大学', 39.9925, 116.3108, 16],
    ['世纪公园 · 上海', 31.2185, 121.5480, 15],
    ['徐汇滨江 · 上海', 31.1790, 121.4460, 16],
    ['西湖 · 杭州', 30.2430, 120.1500, 14],
    ['玄武湖 · 南京', 32.0740, 118.7960, 14],
    ['大明湖 · 济南', 36.6757, 117.0290, 15],
    ['东湖绿道 · 武汉', 30.5500, 114.3600, 14],
    ['湘江风光带 · 长沙', 28.2150, 112.9850, 15],
    ['深圳湾公园 · 深圳', 22.5110, 113.9480, 15],
    ['二沙岛 · 广州', 23.1130, 113.3360, 16],
    ['环岛路 · 厦门', 24.4370, 118.1100, 15],
    ['锦城湖 · 成都', 30.5730, 104.0550, 16],
    ['曲江池遗址公园 · 西安', 34.2040, 108.9770, 15],
    ['星海广场 · 大连', 38.8840, 121.5830, 15],
    ['松花江畔 · 哈尔滨', 45.7800, 126.6180, 15]
  ];

  /* 地理编码服务链：按顺序试，第一个给出结果的就用它。
     Photon 排第一是因为国内网络直连 geocode.arcgis.com 实测 15s 无响应（根本连不上，
     这正是「搜索总是超时」的原因），而 Photon 用 OSM 数据、返回 ACAO:*、实测 1~2s 出结果；
     Esri 留在后面给海外网络兜底。 */
  const GEO_SOURCES = [
    {
      id: 'Photon', ms: 6000,
      url: (q, c) => 'https://photon.komoot.io/api/?limit=8&q=' + encodeURIComponent(q)
        + (c ? '&lat=' + c.lat.toFixed(4) + '&lon=' + c.lon.toFixed(4) : ''),
      parse: d => (d.features || []).map(f => {
        const p = f.properties || {}, co = f.geometry && f.geometry.coordinates;
        if (!co || !p.name) return null;
        const where = [p.city, p.state, p.country].filter(Boolean).join(' · ');
        return { label: p.name + (where ? '（' + where + '）' : ''), lat: co[1], lon: co[0] };
      }).filter(Boolean).slice(0, 8)
    },
    {
      id: 'Esri', ms: 6000,
      url: q => 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'
        + '?f=json&maxLocations=8&outFields=City,Region,Country&singleLine=' + encodeURIComponent(q),
      parse: d => (d.candidates || []).map(c => ({
        label: c.address + (c.attributes && c.attributes.Region ? '（' + c.attributes.Region + '）' : ''),
        lat: c.location.y, lon: c.location.x
      })).slice(0, 8)
    }
  ];

  /* 找地点：坐标直接跳转；地名走上面的服务链（联网时），失败给出明确提示 */
  async function findPlace() {
    const input = $('#placeInput');
    const box = $('#placeResults');
    const raw = (input.value || '').trim();
    box.hidden = false;
    box.innerHTML = '';

    // 经纬度：支持 "40.017, 116.387" / "40.017 116.387" / "40.017，116.387"
    const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) {
      const lat = +m[1], lon = +m[2];
      if (Math.abs(lat) > 84 || Math.abs(lon) > 180 || Math.abs(lat) < 0.01) {
        box.textContent = '经纬度超出范围：纬度 ±84、经度 ±180';
        return;
      }
      window.MapPicker.setCenter(lat, lon, 17);
      box.textContent = '已跳转：' + lat.toFixed(5) + ', ' + lon.toFixed(5) + '（z17，可再手动微调）';
      setTimeout(() => { box.hidden = true; }, 3000);
      return;
    }
    if (!raw) { box.textContent = '输入经纬度（如 40.0175, 116.3878）或要搜索的地名'; return; }

    const bias = window.MapPicker.center();
    let netFail = 0;
    for (let i = 0; i < GEO_SOURCES.length; i++) {
      const src = GEO_SOURCES[i];
      box.textContent = i ? '搜索中…（换备用服务）' : '搜索中…';
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), src.ms);
      try {
        const r = await fetch(src.url(raw, bias), { signal: ctrl.signal });
        if (!r.ok) throw new Error('http ' + r.status);
        const hits = src.parse(await r.json());
        if (hits.length) {
          box.textContent = '';
          hits.forEach(h => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'place-item';
            b.textContent = h.label;
            b.addEventListener('click', () => {
              window.MapPicker.setCenter(h.lat, h.lon, 16);
              box.hidden = true;
            });
            box.appendChild(b);
          });
          return;
        }
      } catch (e) {
        netFail++;
      } finally {
        clearTimeout(timer);
      }
    }
    box.textContent = netFail === GEO_SOURCES.length
      ? '地名搜索超时（' + GEO_SOURCES.map(s => s.id).join(' / ') + ' 都连不上），可直接粘贴经纬度跳转，或用上方快选'
      : '没搜到「' + raw + '」，换个写法或直接粘贴经纬度';
  }

  let pickerTimer = null;
  function pickerTrack() {
    // 校准点优先：用户沿跑道点下的锚点拟合环 > 手绘笔画 > 内置演示
    const cal = window.MapPicker.calLoop();
    if (cal) return [cal];
    const pk = window.MapPicker.ready() ? window.MapPicker.get() : null;
    return pk ? pk.strokes : null;
  }

  function onTrackChange() {
    const km = window.MapPicker.trackKm();
    const nCal = window.MapPicker.calCount();
    $('#pickInfo').textContent = nCal >= 3
      ? '已按 ' + nCal + ' 个校准点拟合出 ' + km.toFixed(2) + ' km 环形轨迹 · 改完参数点「生成截图」'
      : nCal > 0
        ? '已点 ' + nCal + ' 个校准点，再点 ' + (3 - nCal) + ' 个即可自动拟合（建议 4~6 个，弯道前后、直道中部各点几个）'
        : km > 0.05
          ? '已画 ' + km.toFixed(2) + ' km · 闭环自动按里程换算圈数，改完参数点「生成截图」'
          : '先缩放到你的跑步地点，再切「画线」沿路线描一圈，或切「校准」在跑道上点 3~6 个点自动拟合';
    if (!state.records.length || !isCustomLocation() || state.busy) return;
    clearTimeout(pickerTimer);
    pickerTimer = setTimeout(() => generate(), 280);
  }

  function initPicker() {
    const city = $('#pickCity');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— 选择城市 —';
    city.appendChild(placeholder);
    CITIES.forEach(c => {
      const o = document.createElement('option');
      o.value = c[0];
      o.dataset.lat = c[1];
      o.dataset.lon = c[2];
      o.dataset.z = 12;
      o.textContent = c[0];
      city.appendChild(o);
    });
    const pg = document.createElement('optgroup');
    pg.label = '热门跑步地点';
    PLACES.forEach(c => {
      const o = document.createElement('option');
      o.value = c[0];
      o.dataset.lat = c[1];
      o.dataset.lon = c[2];
      o.dataset.z = c[3];
      o.textContent = c[0];
      pg.appendChild(o);
    });
    city.appendChild(pg);
    city.addEventListener('change', () => {
      const o = city.selectedOptions[0];
      if (!o || !o.dataset.lat) return;
      window.MapPicker.setCenter(+o.dataset.lat, +o.dataset.lon, +o.dataset.z || 12);
    });

    $('#placeGo').addEventListener('click', findPlace);
    $('#placeInput').addEventListener('keydown', e => { if (e.key === 'Enter') findPlace(); });

    $('#pickBase').addEventListener('change', () => {
      window.MapPicker.setBase($('#pickBase').value);
      if (isCustomLocation() && state.records.length && !state.busy) generate();
    });

    [['#pickMove', 'move'], ['#pickDraw', 'draw'], ['#pickCal', 'cal']].forEach(([sel, m]) => {
      $(sel).addEventListener('click', () => {
        window.MapPicker.setMode(m);
        $('#pickMove').classList.toggle('on', m === 'move');
        $('#pickDraw').classList.toggle('on', m === 'draw');
        $('#pickCal').classList.toggle('on', m === 'cal');
      });
    });
    $('#pickZin').addEventListener('click', () => window.MapPicker.zoomBy(1));
    $('#pickZout').addEventListener('click', () => window.MapPicker.zoomBy(-1));
    $('#pickUndo').addEventListener('click', () => window.MapPicker.undo());
    $('#pickClear').addEventListener('click', () => window.MapPicker.clear());

    // 大图模式：把整块选点器（地图+工具栏）搬进全屏浮层，退出后放回原位
    let bigOpen = false, bigOverlay = null, pickSlot = null;
    function toggleBig() {
      const blk = $('#pickBlock'), btn = $('#pickBig');
      if (!bigOpen) {
        bigOpen = true;
        pickSlot = document.createElement('div');
        blk.parentNode.insertBefore(pickSlot, blk);
        bigOverlay = document.createElement('div');
        bigOverlay.className = 'pickbig';
        bigOverlay.appendChild(blk);
        document.body.appendChild(bigOverlay);
        btn.textContent = '退出大图';
      } else {
        bigOpen = false;
        pickSlot.parentNode.insertBefore(blk, pickSlot);
        pickSlot.remove(); pickSlot = null;
        bigOverlay.remove(); bigOverlay = null;
        btn.textContent = '⛶ 大图';
      }
      if (window.MapPicker.resize) window.MapPicker.resize();
    }
    $('#pickBig').addEventListener('click', toggleBig);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && bigOpen) toggleBig(); });

    window.MapPicker.init($('#pickCanvas'), onTrackChange);
  }

  /* 调试 / 自检用的示例轨迹：一条标准 400 m 跑道形状的闭环（约 400 m/圈）。
     中心取北京奥森公园，仅用于演示「手绘轨迹 → 自动换算圈数」，不代表任何真实场地。 */
  function demoUserTrack() {
    const latC = 40.0175, lonC = 116.3878;
    const ky = 111320, kx = 111320 * Math.cos(latC * Math.PI / 180);
    const straight = 84.39, r = 36.8;          // 标准跑道直道长与半圆半径（米，测量线）
    const pts = [];
    const add = (mx, my) => pts.push([latC + my / ky, lonC + mx / kx]);
    const arc = (cx, sign, from, to, n) => {
      for (let i = 0; i <= n; i++) {
        const a = from + (to - from) * i / n;
        add(cx + sign * r * Math.cos(a), r * Math.sin(a));
      }
    };
    add(-straight / 2, -r); add(straight / 2, -r);
    arc(straight / 2, 1, -Math.PI / 2, Math.PI / 2, 24);   // 右半圆，向外鼓
    add(straight / 2, r); add(-straight / 2, r);
    arc(-straight / 2, 1, Math.PI / 2, Math.PI * 1.5, 24); // 左半圆，向外鼓
    return [pts];
  }

  function init() {
    const today = new Date();
    const monday = new Date(today.getTime());
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    $('#startDate').value = U.dateKey(monday);
    $('#seed').value = randomSeed();

    const loc = $('#location');
    const pg = document.createElement('optgroup');
    pg.label = '城市公园';
    window.TileMap.PRESETS.forEach(p => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      pg.appendChild(o);
    });
    loc.appendChild(pg);
    const cg = document.createElement('optgroup');
    cg.label = '自定义';
    const co = document.createElement('option');
    co.value = 'custom';
    co.textContent = '自定义地图（选点画轨迹）';
    cg.appendChild(co);
    loc.appendChild(cg);

    initPicker();

    document.querySelectorAll('#weekdayChips .chip').forEach(el => {
      el.classList.toggle('on', WEEKDAY_DEFAULT.indexOf(+el.dataset.wd) >= 0);
      el.addEventListener('click', () => el.classList.toggle('on'));
    });

    document.querySelectorAll('#routeChips .chip').forEach(el => {
      el.classList.add('on');
      el.addEventListener('click', () => {
        if (el.classList.contains('dim')) return;
        el.classList.toggle('on');
        if (!document.querySelector('#routeChips .chip.on')) el.classList.add('on');
      });
    });
    const q0 = new URLSearchParams(location.search);
    if (q0.get('loc') && [...loc.options].some(o => o.value === q0.get('loc'))) {
      loc.value = q0.get('loc');
    }
    syncLocationLock();

    $('#btnGenerate').addEventListener('click', generate);
    $('#btnReroll').addEventListener('click', () => {
      $('#seed').value = randomSeed();
      generate();
    });
    $('#btnZip').addEventListener('click', downloadZip);
    $('#btnDownloadOne').addEventListener('click', () => downloadOne(state.current));
    $('#btnPrev').addEventListener('click', () => stepModal(-1));
    $('#btnNext').addEventListener('click', () => stepModal(1));
    $('#btnCancel').addEventListener('click', () => { state.cancel = true; });
    document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
    document.addEventListener('keydown', e => {
      if ($('#modal').hidden) return;
      if (e.key === 'Escape') closeModal();
      if (e.key === 'ArrowLeft') stepModal(-1);
      if (e.key === 'ArrowRight') stepModal(1);
    });
    const refreshModeBadge = () => {
      $('#modeBadge').textContent = MAP_MODE_LABEL[$('#mapMode').value] || '离线底图';
    };
    $('#mapMode').addEventListener('change', () => {
      refreshModeBadge();
      window.TileMap.reset();
    });
    $('#location').addEventListener('change', syncLocationLock);

    if (location.search.indexOf('selftest') >= 0) { runSelftest(); return; }
    if (location.search.indexOf('shot') >= 0) { runShot(); return; }
    if (location.search.indexOf('auto') >= 0) { setTimeout(generate, 60); }
    if (location.search.indexOf('ziptest') >= 0) { runZipTest(); }
  }

  /* 导出链路冒烟测试：验证 canvas.toBlob + ZIP 组装 */
  async function runZipTest() {
    const p = buildTestParams({ weeks: 1, perWeek: 3, routes: ['block', 'track', 'figure8'] });
    const recs = window.Generator.build(p);
    const files = [];
    for (let i = 0; i < recs.length; i++) {
      const cv = await window.Render.render(recs[i], { scale: 3, mapMode: 'procedural' });
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      files.push({ name: window.Generator.fileName(recs[i], i), data: new Uint8Array(await blob.arrayBuffer()) });
    }
    files.push({ name: 'manifest.csv', data: new TextEncoder().encode(toCSV(recs)) });
    const zip = window.Zip.build(files);
    console.log('ZIPTEST files=' + files.length + ' pngBytes=' + files[0].data.length + ' zipBytes=' + zip.size);
  }

  /* 单张全分辨率出图模式：index.html?shot=1&dist=5.21&pace=305&route=track */
  async function runShot() {
    const q = new URLSearchParams(location.search);
    const dist = parseFloat(q.get('dist') || '5.21');
    const pace = parseInt(q.get('pace') || '305', 10);
    const loc = q.get('loc') || 'aosen';
    const isCustom = loc === 'custom';
    const route = q.get('route') || 'block';
    const mode = q.get('mode') || (isCustom ? 'satellite' : 'procedural');
    let customTrack = null;
    if (isCustom) {
      customTrack = pickerTrack() || demoUserTrack();
    }
    const p = buildTestParams({
      distanceMin: dist, distanceMax: dist,
      paceMin: pace, paceMax: pace,
      weeks: 1, perWeek: 1, routes: isCustom ? ['userdraw'] : [route],
      mapMode: mode,
      customTrack,
      startDate: q.get('date') || '2026-11-09',
      tStartMin: 430, tEndMin: 435,
      seed: q.get('seed') || 'shot',
      location: loc,
      elev: q.get('elev') ? parseElev(q.get('elev')) : null,
      tagText: q.get('tag') || ''
    });
    const rec = window.Generator.build(p)[0];
    const cv = await window.Render.render(rec, { scale: 3, mapMode: mode });
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.display = 'block';
    document.body.style.background = '#fff';
    document.body.style.overflow = 'hidden';
    cv.style.width = '1080px';
    cv.style.height = '2400px';
    cv.style.display = 'block';
    document.body.appendChild(cv);
    document.title = 'shot ' + rec.distanceText + ' ' + rec.paceText;
  }

  /* ---------------- 参数 ---------------- */

  function num(sel) { return parseFloat($(sel).value); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* 解析爬升输入：'' → null（自动）；'12' → {a:12,b:12}；'4-18' / '4~18' / '4 到 18' → {a:4,b:18} */
  function parseElev(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    const norm = s.replace(/[～~—–−﹣至到]/g, '-').replace(/\s+/g, '');
    const m = norm.match(/^(-?\d+(?:\.\d+)?)(?:-(-?\d+(?:\.\d+)?))?$/);
    if (!m) throw new Error('爬升高度格式不对：填单个数字如 12，或区间如 4-18');
    let a = clamp(Math.round(parseFloat(m[1])), 0, 5000);
    let b = m[2] != null ? clamp(Math.round(parseFloat(m[2])), 0, 5000) : a;
    if (b < a) { const t = a; a = b; b = t; }
    return { a, b };
  }

  function readParams() {
    const dMin = num('#dMin'), dMax = num('#dMax');
    if (!isFinite(dMin) || !isFinite(dMax) || dMin <= 0) throw new Error('距离范围填写有误');
    if (dMax < dMin) throw new Error('距离上限需要大于下限');

    const pMin = U.parsePace($('#pMin').value);
    const pMax = U.parsePace($('#pMax').value);
    if (!isFinite(pMin) || !isFinite(pMax)) throw new Error('配速格式不对，示例 5\'30"');
    if (pMax < pMin) throw new Error('配速上限需要大于下限');
    if (pMin < 150 || pMax > 900) throw new Error('配速建议落在 2\'30" ~ 15\'00" 之间');

    const weeks = clamp(Math.round(num('#weeks') || 1), 1, 26);
    const perWeek = clamp(Math.round(num('#perWeek') || 1), 1, 7);
    if (weeks * perWeek > 60) throw new Error('单次最多 60 张，请减少周数或每周张数');

    const tStartMin = U.hhmmToMinutes($('#tStart').value);
    const tEndMin = U.hhmmToMinutes($('#tEnd').value);
    if (!isFinite(tStartMin) || !isFinite(tEndMin)) throw new Error('开跑时段格式有误');

    let weekdays = Array.from(document.querySelectorAll('#weekdayChips .chip.on')).map(e => +e.dataset.wd);
    if (!weekdays.length) weekdays = WEEKDAY_DEFAULT.slice();

    const custom = isCustomLocation();
    let customTrack = null;
    if (custom) {
      customTrack = pickerTrack();
      if (!customTrack) throw new Error('请先在地图上定轨迹：切「画线」沿路线描一圈，或切「校准」在跑道上点 3~6 个点自动拟合');
    }
    let routes = Array.from(document.querySelectorAll('#routeChips .chip.on')).map(e => e.dataset.kind);
    if (custom) routes = ['userdraw'];
    if (!routes.length) routes.push('block');

    const weight = clamp(num('#weight') || 60, 35, 130);
    let hrMin = clamp(num('#hrMin') || 135, 90, 200);
    let hrMax = clamp(num('#hrMax') || 172, 90, 200);
    if (hrMax < hrMin) { const t = hrMin; hrMin = hrMax; hrMax = t; }

    const elev = parseElev($('#elevInput').value);

    return {
      distanceMin: Math.min(dMin, dMax),
      distanceMax: Math.max(dMin, dMax),
      paceMin: pMin,
      paceMax: pMax,
      startDate: $('#startDate').value || U.dateKey(new Date()),
      weeks,
      perWeek,
      weekdays,
      tStartMin,
      tEndMin,
      weight,
      hrMin,
      hrMax,
      elev,
      cadenceMin: 164,
      cadenceMax: 188,
      routes,
      customTrack,
      mapMode: custom
        ? ({ street: 'tiles', google: 'googlesat', gaode: 'gaodesat' }[window.MapPicker.base()] || 'satellite')
        : $('#mapMode').value,
      location: custom ? 'custom' : $('#location').value,
      tagText: $('#tagText').value,
      seed: ($('#seed').value || '').trim() || randomSeed()
    };
  }

  /* ---------------- 生成 ---------------- */

  async function generate() {
    if (state.busy) return;
    let p;
    try {
      p = readParams();
      state.records = window.Generator.build(p);
    } catch (e) {
      toast(e.message);
      return;
    }
    state.params = p;
    if (!$('#seed').value.trim()) $('#seed').value = p.seed;
    await renderGrid();
  }

  async function renderGrid() {
    const p = state.params;
    const grid = $('#grid');
    const records = state.records;
    grid.innerHTML = '';

    const cards = records.map((rec, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        '<div class="thumb"><canvas></canvas><button class="quick">下载</button></div>' +
        '<div class="meta"><b>' + rec.dateISO.slice(5) + ' 周' + U.weekdayCN(rec.weekday) + '</b><span>' + rec.startText + '</span></div>' +
        '<div class="meta sub"><span>' + rec.distanceText + ' km</span><span class="mp">' + rec.paceText + '</span></div>';
      card.addEventListener('click', e => {
        if (e.target.classList && e.target.classList.contains('quick')) {
          e.stopPropagation();
          downloadOne(i, e.target);
        } else {
          openModal(i);
        }
      });
      grid.appendChild(card);
      return { card, rec };
    });

    $('#btnZip').disabled = true;

    for (let i = 0; i < cards.length; i++) {
      if (i % 3 === 0) await nextFrame();
      const { card, rec } = cards[i];
      const cv = await renderSafe(rec, 1);
      const holder = card.querySelector('.thumb');
      const old = holder.querySelector('canvas');
      cv.style.width = '100%';
      cv.style.height = 'auto';
      holder.replaceChild(cv, old);
      $('#summary').innerHTML = '已生成 <b>' + cards.length + '</b> 张 · 渲染中 ' + (i + 1) + '/' + cards.length;
    }

    const totalKm = records.reduce((s, r) => s + r.distanceKm, 0);
    const avgPace = Math.round(records.reduce((s, r) => s + r.paceSec, 0) / Math.max(1, records.length));
    $('#summary').innerHTML =
      '已生成 <b>' + records.length + '</b> 张 · 总里程 <b>' + totalKm.toFixed(2) + ' km</b> · 平均配速 <b>' +
      U.pace(avgPace) + '</b> · ' + (MAP_MODE_LABEL[p.mapMode] || '');
    $('#btnZip').disabled = false;
  }

  function nextFrame() {
    return new Promise(r => requestAnimationFrame(() => r()));
  }

  async function renderSafe(rec, scale) {
    const p = state.params || { mapMode: 'procedural' };
    try {
      return await window.Render.render(rec, { scale, mapMode: p.mapMode });
    } catch (e) {
      return await window.Render.render(rec, { scale, mapMode: 'procedural' });
    }
  }

  /* ---------------- 弹窗 ---------------- */

  async function openModal(i) {
    state.current = i;
    const rec = state.records[i];
    $('#modal').hidden = false;
    $('#modalTitle').textContent = rec.id + ' · ' + rec.dateISO + ' 周' + U.weekdayCN(rec.weekday);
    $('#modalFacts').innerHTML = [
      ['开跑 / 完成', rec.startText + ' → ' + rec.finishText],
      ['距离', rec.distanceText + ' km'],
      ['平均配速', rec.paceText],
      ['训练时长', rec.durText],
      ['步频 / 步幅', rec.cadence + ' / ' + rec.strideText + ' m'],
      ['步数', String(rec.steps)],
      ['消耗', rec.kcal + ' 千卡'],
      ['平均心率', rec.hr + ' 次/分'],
      ['运动负荷', String(rec.load)],
      ['平均功率', rec.power + ' 瓦'],
      ['爬升高度', rec.elev + ' 米'],
      ['路线', rec.routeName]
    ].map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('');

    const cv = await renderSafe(rec, 2);
    const target = $('#modalCanvas');
    target.width = cv.width;
    target.height = cv.height;
    target.getContext('2d').drawImage(cv, 0, 0);
  }

  function stepModal(delta) {
    if ($('#modal').hidden) return;
    const n = state.records.length;
    if (!n) return;
    openModal((state.current + delta + n) % n);
  }

  function closeModal() { $('#modal').hidden = true; }

  /* ---------------- 导出 ---------------- */

  function triggerDownload(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function downloadOne(i, btn) {
    const rec = state.records[i];
    if (!rec) return;
    if (btn) btn.disabled = true;
    try {
      const cv = await renderSafe(rec, 3);
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      if (!blob) throw new Error('导出失败');
      triggerDownload(blob, window.Generator.fileName(rec, i));
      toast('已下载 ' + window.Generator.fileName(rec, i));
    } catch (e) {
      toast('导出失败：' + e.message);
    }
    if (btn) btn.disabled = false;
  }

  function toCSV(records) {
    const head = ['编号', '日期', '星期', '开跑', '完成', '距离(km)', '平均配速', '训练时长', '总时长',
      '平均步频', '平均步幅(m)', '步数', '平均心率', '运动负荷', '平均功率(W)', '消耗(kcal)', '爬升(m)', '路线', '种子'];
    const rows = records.map(r => [
      r.id, r.dateISO, '周' + U.weekdayCN(r.weekday), r.startText, r.finishText, r.distanceText, r.paceText,
      r.durText, r.totalText, r.cadence, r.strideText, r.steps, r.hr, r.load, r.power, r.kcal, r.elev, r.routeName, r.seed
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
    return '\uFEFF' + head.join(',') + '\r\n' + rows.join('\r\n');
  }

  async function downloadZip() {
    if (state.busy || !state.records.length) return;
    state.busy = true;
    state.cancel = false;
    const records = state.records;
    showOverlay('正在渲染 ' + records.length + ' 张截图…');
    const files = [];
    try {
      for (let i = 0; i < records.length; i++) {
        if (state.cancel) break;
        setProgress(i / (records.length + 1), '渲染 ' + (i + 1) + ' / ' + records.length);
        await nextFrame();
        const cv = await renderSafe(records[i], 3);
        const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
        if (!blob) throw new Error('第 ' + (i + 1) + ' 张导出失败');
        files.push({ name: window.Generator.fileName(records[i], i), data: new Uint8Array(await blob.arrayBuffer()) });
      }
      if (!state.cancel && files.length) {
        files.push({ name: 'manifest.csv', data: new TextEncoder().encode(toCSV(records.slice(0, files.length))) });
        setProgress(0.97, '正在打包 ZIP…');
        await nextFrame();
        const zip = window.Zip.build(files);
        const first = records[0].dateISO, last = records[files.length - 2].dateISO;
        triggerDownload(zip, 'keep-run_' + first + '_' + last + '_' + (files.length - 1) + '张.zip');
        toast('已打包 ' + (files.length - 1) + ' 张截图');
      }
    } catch (e) {
      toast('打包失败：' + e.message);
    }
    hideOverlay();
    state.busy = false;
  }

  /* ---------------- 进度 / 提示 ---------------- */

  function showOverlay(title) {
    $('#overlay').hidden = false;
    $('#progressTitle').textContent = title;
    $('#progressSub').textContent = '';
    setProgress(0, '准备中…');
  }
  function setProgress(ratio, sub) {
    $('#progressBar').style.width = Math.round(clamp(ratio, 0, 1) * 100) + '%';
    if (sub) $('#progressSub').textContent = sub;
  }
  function hideOverlay() { $('#overlay').hidden = true; }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ---------------- 自检 ---------------- */

  function buildTestParams(overrides) {
    return Object.assign({
      distanceMin: 3, distanceMax: 8, paceMin: 300, paceMax: 400,
      startDate: '2026-01-05', weeks: 4, perWeek: 3, weekdays: [1, 3, 5],
      tStartMin: 360, tEndMin: 480, weight: 60, hrMin: 135, hrMax: 172,
      cadenceMin: 164, cadenceMax: 188, elev: null,
      routes: ['block', 'park', 'track', 'outback', 'river', 'figure8'],
      customTrack: null,
      mapMode: 'procedural', location: 'aosen', tagText: '', seed: 'selftest'
    }, overrides || {});
  }

  async function runSelftest() {
    const p = buildTestParams();
    const recs = window.Generator.build(p);
    const fails = [];
    const check = (cond, msg) => { if (!cond) fails.push(msg); };

    check(recs.length === 12, '数量应为 12，实际 ' + recs.length);

    const perWeekCount = {};
    recs.forEach(r => {
      const key = r.dateISO;
      perWeekCount[key] = 1;
      check(Math.abs(r.durationSec - r.distanceKm * r.paceSec) <= r.distanceKm * 0.5 + 1, r.id + ' 用时与距离×配速不符');
      check(Math.abs(r.steps * r.stride - r.distanceKm * 1000) <= r.distanceKm * 1000 * 0.005, r.id + ' 步数×步幅偏差过大');
      const sum = r.splits.reduce((s, x) => s + x.sec, 0);
      check(sum === r.durationSec, r.id + ' 分段配速求和 ' + sum + ' ≠ ' + r.durationSec);
      check(r.cadence >= 160 && r.cadence <= 192, r.id + ' 步频越界 ' + r.cadence);
      check(r.stride >= 0.72 && r.stride <= 1.5, r.id + ' 步幅越界 ' + r.stride);
      check(r.hr >= 120 && r.hr <= 180, r.id + ' 心率越界 ' + r.hr);
      check(r.startMin >= p.tStartMin && r.startMin <= p.tEndMin, r.id + ' 开跑时刻越界 ' + r.startText);
      check(r.distanceKm >= p.distanceMin - 0.005 && r.distanceKm <= p.distanceMax + 0.005, r.id + ' 距离越界');
      check(r.paceSec >= p.paceMin * 0.94 && r.paceSec <= p.paceMax * 1.06, r.id + ' 配速越界');
      check(r.route.points.length > 10, r.id + ' 轨迹点过少');
    });
    check(Object.keys(perWeekCount).length === 12, '日期/时刻存在重复');

    // 开跑时刻不应整齐落在 5 分钟刻度上；状态栏电量/网速需随机
    const onGrid = recs.filter(r => r.startMin % 5 === 0).length;
    check(onGrid < recs.length * 0.55, '开跑时刻仍集中在 5 分钟刻度（' + onGrid + '/' + recs.length + '）');
    const bat = new Set(recs.map(r => r.status.battery));
    const spd = new Set(recs.map(r => r.status.speed));
    check(bat.size > 1 && spd.size > 1, '状态栏电量/网速没有随机变化');
    check(recs.every(r => r.status.battery >= 19 && r.status.battery <= 98 &&
      r.status.bars >= 2 && r.status.bars <= 4 && /^\d\.\d [KM]\/s$/.test(r.status.speed)), '状态栏字段越界');

    // 截图渲染（含文字绘制）冒烟测试
    try {
      const cv = await window.Render.render(recs[0], { scale: 1, mapMode: 'procedural' });
      check(cv.width === 360 && cv.height === 800, '画布尺寸异常');
      const cv3 = await window.Render.render(recs[0], { scale: 3, mapMode: 'procedural' });
      check(cv3.width === 1080 && cv3.height === 2400, '导出画布尺寸异常');
    } catch (e) {
      fails.push('渲染异常：' + e.message);
    }

    // 操场跑道：里程换算圈数、自动爬升、渲染尺寸
    try {
      const vp = buildTestParams({
        distanceMin: 5.21, distanceMax: 5.21, paceMin: 305, paceMax: 305,
        weeks: 1, perWeek: 1, routes: ['track'],
        mapMode: 'procedural', seed: 'track-selftest'
      });
      const rec = window.Generator.build(vp)[0];
      const pts = rec.route.points;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      // 折线实测长度必然大于标称里程：逐圈换道会绕外道（4 条道平均约 +5%），
      // GPS 抖动还会再拉长一点。真正的不变量是「圈数 × 单圈长 = 标称里程」。
      check(Math.abs(rec.route.laps * rec.route.baseLen - 5210) / 5210 < 0.01,
        '跑道圈数×单圈长 ≠ 标称里程：' + rec.route.laps + ' × ' + rec.route.baseLen);
      check(len > 5210 * 0.98 && len < 5210 * 1.08, '跑道轨迹里程偏差过大 ' + (len / 5210 * 100).toFixed(2) + '%');
      check(rec.route.laps > 12 && rec.route.laps < 14, '跑道圈数换算异常 ' + rec.route.laps);
      check(rec.route.multiLap === true && rec.route.baseLen === 400, '田径场应按标准 400 m 单圈分圈：' + rec.route.baseLen);
      check(rec.elev >= 0 && rec.elev <= 4, '田径场自动爬升应落在 0–4 m，实际 ' + rec.elev);
      const cvV = await window.Render.render(rec, { scale: 1, mapMode: 'procedural' });
      check(cvV.width === 360 && cvV.height === 800, '跑道画布尺寸异常');
    } catch (e) {
      fails.push('跑道渲染异常：' + e.message);
    }

    // 爬升：固定值 / 区间随机 / 场地覆盖
    try {
      const fixed = window.Generator.build(buildTestParams({
        weeks: 1, perWeek: 3, routes: ['block'], seed: 'elev-fixed', elev: { a: 12, b: 12 }
      }));
      check(fixed.every(r => r.elev === 12), '固定爬升未生效：' + fixed.map(r => r.elev).join(','));

      const rng6 = window.Generator.build(buildTestParams({
        weeks: 2, perWeek: 3, routes: ['park'], seed: 'elev-range', elev: { a: 5, b: 9 }
      }));
      check(rng6.every(r => r.elev >= 5 && r.elev <= 9), '区间爬升越界：' + rng6.map(r => r.elev).join(','));
      check(new Set(rng6.map(r => r.elev)).size > 1, '区间爬升没有随机变化：' + rng6.map(r => r.elev).join(','));

      const trackFixed = window.Generator.build(buildTestParams({
        weeks: 1, perWeek: 1, routes: ['track'], seed: 'elev-track', elev: { a: 7, b: 7 }
      }))[0];
      check(trackFixed.elev === 7, '跑道模式下固定爬升未生效：' + trackFixed.elev);

      check(parseElev('') === null, '空输入应返回自动模式');
      check(JSON.stringify(parseElev('4~18')) === '{"a":4,"b":18}', 'parseElev 区间解析异常');
      check(JSON.stringify(parseElev('12')) === '{"a":12,"b":12}', 'parseElev 单值解析异常');
    } catch (e) {
      fails.push('爬升配置异常：' + e.message);
    }

    // 自定义地图：手绘轨迹闭环换圈数、里程缩放、标签、渲染
    try {
      const track = demoUserTrack();
      const cp = buildTestParams({
        weeks: 1, perWeek: 2, routes: ['userdraw'], location: 'custom',
        customTrack: track, mapMode: 'procedural', seed: 'userdraw-test',
        distanceMin: 5.21, distanceMax: 5.21
      });
      const urecs = window.Generator.build(cp);
      check(urecs.length === 2, '自定义地图数量异常 ' + urecs.length);
      check(urecs.every(r => r.routeKind === 'userdraw' && r.route.origin), '手绘轨迹缺少 origin');
      check(urecs.every(r => r.tag === '自定义地图'), '自定义地图标签错误：' + urecs[0].tag);
      check(urecs.every(r => r.route.points.length > 20), '手绘轨迹点过少');
      const pts = urecs[0].route.points;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      // 套圈轨迹保留描线原尺寸（与地图上的真实跑道对齐），换道绕外圈会让折线比标称里程长 5–10%；
      // 标称里程的不变量仍是「圈数 × 单圈长」。
      check(Math.abs(urecs[0].route.laps * urecs[0].route.baseLen - 5210) / 5210 < 0.01,
        '手绘闭环 圈数×单圈长 ≠ 标称里程：' + urecs[0].route.laps + ' × ' + urecs[0].route.baseLen);
      check(len > 5210 * 0.98 && len < 5210 * 1.15, '手绘轨迹里程偏差 ' + (len / 5210 * 100).toFixed(2) + '%');
      check(urecs[0].route.multiLap === true, '手绘闭环应按里程分圈换道');
      check(urecs[0].route.laps >= 10, '闭环应按里程换算圈数，实际 ' + urecs[0].route.laps);
      check(urecs[0].route.closed === true, '体育场示例轨迹应识别为闭环');
      // 非闭环（开放路径）应整体缩放到目标里程
      const openTrack = [[[40.0210, 116.3830], [40.0245, 116.3865], [40.0200, 116.3890]]];
      const op = buildTestParams({
        weeks: 1, perWeek: 1, routes: ['userdraw'], location: 'custom',
        customTrack: openTrack, seed: 'userdraw-open',
        distanceMin: 3.0, distanceMax: 3.0
      });
      const orec = window.Generator.build(op)[0];
      const opts2 = orec.route.points;
      let olen = 0;
      for (let i = 1; i < opts2.length; i++) olen += Math.hypot(opts2[i][0] - opts2[i - 1][0], opts2[i][1] - opts2[i - 1][1]);
      check(orec.route.laps === 1 && Math.abs(olen - 3000) / 3000 < 0.02, '开放轨迹应单程缩放到目标里程');
      const cvU = await window.Render.render(urecs[0], { scale: 1, mapMode: 'procedural' });
      check(cvU.width === 360 && cvU.height === 800, '自定义地图画布尺寸异常');
    } catch (e) {
      fails.push('自定义地图异常：' + e.message);
    }

    const grid = $('#grid');
    grid.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'selftest';
    box.innerHTML = '<h2>自检结果：' + (fails.length ? '<span class="bad">' + fails.length + ' 项未通过</span>' : '<span class="ok">全部通过</span>') + '</h2>' +
      '<ul>' + (fails.length ? fails.map(f => '<li class="bad">' + f + '</li>').join('') : '<li class="ok">12 条记录数字自洽，步频/步幅/心率/时刻全部在合理域</li>') + '</ul>';
    grid.appendChild(box);
    const preview = await window.Render.render(recs[0], { scale: 1, mapMode: 'procedural' });
    preview.style.width = '220px';
    preview.style.borderRadius = '10px';
    grid.appendChild(preview);
    $('#summary').innerHTML = '自检模式 · ' + (fails.length ? '存在失败项' : '通过');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
