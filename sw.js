/* 应用外壳离线缓存：地图瓦片等跨域请求不缓存，断网时仍可用离线底图出图 */
const CACHE = 'runshot-v1';
const INDEX = new URL('./index.html', self.location).href;

const CORE = [
  './',
  './index.html',
  './css/style.css',
  './js/rng.js',
  './js/zip.js',
  './js/routes.js',
  './js/generator.js',
  './js/map-procedural.js',
  './js/map-picker.js',
  './js/map-tiles.js',
  './js/render.js',
  './js/star.js',
  './js/main.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 瓦片、地名检索等交给网络

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(INDEX, fresh.clone());
        return fresh;
      } catch (err) {
        return (await cache.match(req, { ignoreSearch: true })) ||
               (await cache.match(INDEX)) ||
               Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) {
      fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
      }).catch(() => {});
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
