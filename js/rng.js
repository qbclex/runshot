/* 种子化随机数 + 通用格式化工具 */
(function (global) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStr(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  class Rng {
    constructor(seed) {
      this.seed = (seed >>> 0) || 0x9e3779b9;
      this._f = mulberry32(this.seed);
    }
    next() { return this._f(); }
    float(a, b) { return a + (b - a) * this._f(); }
    int(a, b) { return Math.floor(a + (b - a + 1) * this._f()); }
    pick(arr) { return arr[Math.floor(this._f() * arr.length) % arr.length]; }
    chance(p) { return this._f() < p; }
    gauss(mean, sd) {
      let u = 0, v = 0;
      while (u === 0) u = this._f();
      while (v === 0) v = this._f();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(this._f() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
  }

  const U = {
    clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
    pad(n, w) { return String(Math.abs(Math.trunc(n))).padStart(w || 2, '0'); },
    /** 秒 -> 1:23:45 / 13:26 */
    clock(sec) {
      sec = Math.max(0, Math.round(sec));
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      return (h > 0 ? h + ':' + U.pad(m) : U.pad(m)) + ':' + U.pad(s);
    },
    /** 秒 -> 00:13:26 */
    clockFull(sec) {
      sec = Math.max(0, Math.round(sec));
      return U.pad(Math.floor(sec / 3600)) + ':' + U.pad(Math.floor((sec % 3600) / 60)) + ':' + U.pad(sec % 60);
    },
    /** 秒/公里 -> 04'28" */
    pace(sec) {
      sec = Math.max(0, Math.round(sec));
      let m = Math.floor(sec / 60), s = sec % 60;
      return U.pad(m) + "'" + U.pad(s) + '"';
    },
    /** 268 -> "4'28"" 输入解析 */
    parsePace(str) {
      const m = String(str).replace(/[“”"′']/g, "'").match(/(\d+)\s*'\s*(\d+)/);
      if (m) return (+m[1]) * 60 + (+m[2]);
      const n = parseFloat(str);
      if (!isNaN(n) && n > 0 && n < 30) return Math.round(n * 60); // 支持 5.5 形式
      return NaN;
    },
    minutesToHHMM(min) {
      min = ((Math.round(min) % 1440) + 1440) % 1440;
      return U.pad(Math.floor(min / 60)) + ':' + U.pad(min % 60);
    },
    hhmmToMinutes(str) {
      const m = String(str).match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
      if (!m) return NaN;
      return (+m[1]) * 60 + (+m[2]);
    },
    km(v) { return (Math.round(v * 100) / 100).toFixed(2); },
    dateKey(d) {
      return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
    },
    sameDay(a, b) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    },
    weekdayCN(i) { return '日一二三四五六'[i]; },
    /** Date -> "2026年11月8日 周日" */
    dateCN(d) {
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + U.weekdayCN(d.getDay());
    }
  };

  global.RNG = { Rng, mulberry32, hashStr };
  global.U = U;
})(window);
