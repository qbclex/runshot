/* 记录生成：以「距离 + 配速」为基准推导其余全部指标，保证互相咬合 */
(function (global) {
  'use strict';
  const { Rng, hashStr } = global.RNG;
  const U = global.U;

  const ELEV_RATE = {
    block: [0, 1.2],
    track: [0, 0.5],
    figure8: [1.2, 2.6],
    outback: [1.6, 3.2],
    river: [1.4, 3.0],
    park: [2.0, 4.2],
    userdraw: [0.6, 2.2]
  };

  // 开跑时刻：在区间内均匀随机到「分钟」，不取整到 5 分钟
  function pickMinute(p, rng) {
    let a = p.tStartMin, b = p.tEndMin;
    if (b < a) b += 1440;
    const span = Math.max(2, b - a);
    const m = a + rng.int(0, span);
    return ((m % 1440) + 1440) % 1440;
  }

  // 状态栏：信号格数 / 网络制式 / 实时网速 / 电量，逐张随机
  function makeStatus(rng) {
    const bars = rng.int(2, 4);
    const net = bars <= 2 ? (rng.chance(0.5) ? '4G' : '5G') : (rng.chance(0.88) ? '5G' : '4G');
    const mb = rng.chance(0.16);
    const val = mb ? rng.float(1.1, 6.4) : rng.float(0.3, 9.7);
    return {
      bars,
      net,
      speed: val.toFixed(1) + ' ' + (mb ? 'M' : 'K') + '/s',
      battery: rng.int(19, 98)
    };
  }

  function planDates(p, rng) {
    const start = new Date(p.startDate + 'T00:00:00');
    const out = [];
    for (let w = 0; w < p.weeks; w++) {
      const ws = new Date(start.getTime());
      ws.setDate(ws.getDate() + w * 7);
      let pool = [];
      for (let d = 0; d < 7; d++) {
        const dt = new Date(ws.getTime());
        dt.setDate(ws.getDate() + d);
        if (p.weekdays.indexOf(dt.getDay()) >= 0) pool.push(dt);
      }
      if (!pool.length) {
        pool = [1, 3, 5].map(d => {
          const dt = new Date(ws.getTime());
          dt.setDate(ws.getDate() + ((d - ws.getDay() + 7) % 7));
          return dt;
        });
      }
      let chosen = [];
      if (p.perWeek <= pool.length) {
        chosen = rng.shuffle(pool).slice(0, p.perWeek);
      } else {
        chosen = pool.slice();
        let extra = p.perWeek - pool.length;
        let k = 0;
        while (extra > 0 && k < 21) {
          const dt = new Date(ws.getTime());
          dt.setDate(ws.getDate() + (k % 7));
          if (!chosen.some(c => U.sameDay(c, dt))) { chosen.push(dt); extra--; }
          k++;
        }
      }
      chosen.sort((a, b) => a - b);
      for (const d of chosen) out.push({ date: d, minutes: pickMinute(p, rng) });
    }

    // 去重：同一天同一时刻只保留一条
    const seen = new Set();
    for (const item of out) {
      let guard = 0;
      let key = U.dateKey(item.date) + ' ' + item.minutes;
      while (seen.has(key) && guard++ < 48) {
        item.minutes = (item.minutes + rng.int(1, 4)) % 1440;
        key = U.dateKey(item.date) + ' ' + item.minutes;
      }
      seen.add(key);
    }
    return out;
  }

  function buildSplits(distanceKm, durationSec, rng) {
    const n = Math.floor(distanceKm);
    const parts = [];
    for (let i = 0; i < n; i++) parts.push({ km: i + 1, w: 1 + rng.gauss(0, 0.018) });
    const frac = distanceKm - n;
    if (frac > 0.005) parts.push({ km: +distanceKm.toFixed(2), w: Math.max(0.08, frac) * (1 + rng.gauss(0, 0.02)) });
    const totalW = parts.reduce((s, x) => s + Math.max(0.05, x.w), 0);
    let acc = 0;
    return parts.map((pt, i) => {
      let sec;
      if (i === parts.length - 1) sec = Math.max(1, durationSec - acc);
      else sec = Math.max(1, Math.round(Math.max(0.05, pt.w) / totalW * durationSec));
      acc += sec;
      return { km: pt.km, sec };
    });
  }

  function makeRecord(item, p, rng, idx, kindArg) {
    const distSpan = p.distanceMax - p.distanceMin;
    let distanceKm = rng.float(p.distanceMin, p.distanceMax);
    if (distSpan > 0.02) distanceKm *= 1 + rng.gauss(0, 0.008);
    distanceKm = Math.round(U.clamp(distanceKm, p.distanceMin, p.distanceMax) * 100) / 100;

    const paceSpan = p.paceMax - p.paceMin;
    let paceTarget = rng.float(p.paceMin, p.paceMax);
    if (paceSpan > 3) paceTarget *= 1 + rng.gauss(0, 0.012);
    paceTarget = U.clamp(paceTarget, p.paceMin, p.paceMax);

    const durationSec = Math.floor(distanceKm * paceTarget);
    const paceSec = Math.round(durationSec / distanceKm);
    const paceMin = paceSec / 60;

    const cadence = U.clamp(Math.round(170 + (6.3 - paceMin) * 6 + rng.gauss(0, 2.2)), p.cadenceMin, p.cadenceMax);
    let stride = Math.round((1000 / (cadence * paceMin)) * 100) / 100;
    const steps = Math.max(100, Math.round(distanceKm * 1000 / stride));
    stride = Math.round((distanceKm * 1000 / steps) * 100) / 100;

    const kcal = Math.round(p.weight * distanceKm * 0.87);
    const hr = U.clamp(Math.round(132 + (6.5 - paceMin) * 10 + rng.gauss(0, 2.8)), p.hrMin, p.hrMax);
    const load = Math.round(distanceKm * (9.5 + (6 - paceMin) * 0.5));
    const power = Math.max(80, Math.round(p.weight * (4.05 + (6 - paceMin) * 0.25) + rng.gauss(0, 4)));
    const totalSec = durationSec + rng.int(8, 40);

    const kind = kindArg || (p.routes.length ? rng.pick(p.routes) : 'block');
    const routeRng = new Rng(hashStr(p.seed + ':' + idx + ':route'));
    let route;
    if (kind === 'userdraw') {
      route = global.Routes.buildUser(p.customTrack, distanceKm * 1000, routeRng);
      if (!route) throw new Error('手绘轨迹无效：画得太短了');
    } else {
      route = global.Routes.build(kind, distanceKm * 1000, routeRng);
    }
    const flat = kind === 'track';
    const rate = ELEV_RATE[kind] || ELEV_RATE.block;

    // 爬升：用户指定（固定值 a==b，或区间 [a,b] 随机）优先；留空才按路线类型自动估算
    let elev;
    if (p.elev && isFinite(p.elev.a)) {
      elev = p.elev.a === p.elev.b ? Math.round(p.elev.a) : rng.int(Math.round(p.elev.a), Math.round(p.elev.b));
    } else if (flat) {
      // 田径场实际是平的，只给 GPS 抖动带来的 0–3 m
      elev = Math.max(0, Math.round(distanceKm * rng.float(0.08, 0.55)));
    } else {
      elev = Math.max(1, Math.round(distanceKm * rng.float(rate[0], rate[1]) + rng.gauss(0, 0.6)));
    }

    const start = new Date(item.date.getTime());
    start.setHours(0, item.minutes, 0, 0);
    const finish = new Date(start.getTime() + totalSec * 1000);

    return {
      idx,
      id: 'RUN-' + String(idx + 1).padStart(2, '0'),
      seed: p.seed + '#' + idx,
      date: item.date,
      dateISO: U.dateKey(item.date),
      dateText: U.dateCN(item.date),
      weekday: item.date.getDay(),
      startMin: item.minutes,
      startText: U.minutesToHHMM(item.minutes),
      finishText: U.pad(finish.getHours()) + ':' + U.pad(finish.getMinutes()),
      distanceKm,
      distanceText: U.km(distanceKm),
      durationSec,
      durText: U.clockFull(durationSec),
      totalSec,
      totalText: U.clockFull(totalSec),
      paceSec,
      paceText: U.pace(paceSec),
      cadence,
      stride: Math.round(stride * 100) / 100,
      strideText: stride.toFixed(2),
      steps,
      kcal,
      hr,
      load,
      power,
      elev,
      splits: buildSplits(distanceKm, durationSec, rng),
      route,
      routeKind: kind,
      routeName: kind === 'userdraw' ? '自定义地图' : route.name,
      tag: p.tagText && p.tagText.trim() ? p.tagText.trim() : (kind === 'userdraw' ? '自定义地图' : route.name),
      mapSeed: rng.int(1, 2147483000),
      status: makeStatus(rng),
      location: p.location || null
    };
  }

  function build(p) {
    const rng = new Rng(hashStr(String(p.seed)));
    const plan = planDates(p, rng);

    // 轨迹轮转分配，保证多选路线时每种都能出现
    const kinds = [];
    const pool = [];
    const rrng = new Rng(hashStr(p.seed + ':routeplan'));
    const routeList = p.routes && p.routes.length ? p.routes : ['block'];
    for (let i = 0; i < plan.length; i++) {
      if (p.customTrack && p.customTrack.length) { kinds.push('userdraw'); continue; }
      if (!pool.length) pool.push.apply(pool, rrng.shuffle(routeList.slice()));
      kinds.push(pool.pop());
    }

    const recs = plan.map((item, i) => makeRecord(item, p, new Rng(hashStr(p.seed + ':rec:' + i)), i, kinds[i]));
    recs.sort((a, b) => (a.date - b.date) || (a.startMin - b.startMin));
    recs.forEach((r, i) => {
      r.id = 'RUN-' + String(i + 1).padStart(2, '0');
      r.idx = i;
    });
    return recs;
  }

  function fileName(rec, i) {
    return 'keep-run-' + String(i + 1).padStart(2, '0') + '_' + rec.dateISO + '_' + rec.distanceText + 'km.png';
  }

  global.Generator = { build, fileName };
})(window);
