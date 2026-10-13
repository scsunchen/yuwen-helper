/* ==================================================================
 * Service Worker — 小学语文预习小助手
 * 策略：
 *   - 页面骨架（html/css/js/lib）：stale-while-revalidate，秒开 + 后台更新
 *   - 数据（JSON）：cache-first，教材/笔顺数据基本不变，缓存后离线可用
 *   - 首次访问后，全部已加载资源均可离线使用
 * ================================================================== */

const VERSION = 'v2.13.1';
const STATIC_CACHE = `yw-static-${VERSION}`;
const DATA_CACHE = `yw-data-${VERSION}`;

// 安装时预缓存应用骨架 + 版本清单（体积很小）
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './lib/hanzi-writer.min.js',
  './manifest.webmanifest',
  './data/textbook/textbooks.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 跨域（如 CDN 兜底）交给浏览器

  const isData = url.pathname.includes('/data/');

  if (isData) {
    // 数据：缓存优先，命中即离线可用
    e.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // 骨架资源：stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
