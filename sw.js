/* DayFlow 手机版 Service Worker
   只缓存应用外壳；数据（pack.json / IndexedDB）不缓存，保证每次联网都能拿到新包。
   版本号由 bin/build-pwa.mjs 在构建时写入，改代码重新部署后会自动换缓存。 */
const VERSION = '202611190521';
const CACHE = `dayflow-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './schedule.css',
  './schedule.js',
  './boot.js',
  './pwa.css',
  './manifest.webmanifest',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './courses/index.html',
  './courses/app.js',
  './courses/style.css',
  './courses/static-api.js',
  './courses/courses-data.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' 绕过浏览器 HTTP 缓存（GitHub Pages 给的是 max-age=600，
      // 否则新 SW 可能把旧文件预缓存进来，界面就一直不更新）
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 地图瓦片等跨境请求走网络
  if (url.pathname.endsWith('/pack.json')) return; // 数据包永远走网络

  event.respondWith(
    caches.match(req, { ignoreSearch: false }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    }),
  );
});
