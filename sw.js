// 实验日程 · Service Worker：离线缓存 + 接收推送
// 发布新版本时把 VERSION 改一下，用户下次打开会提示“有新版本”。
const VERSION = '1.1.0';
const CACHE = 'lab-planner-' + VERSION;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/core.js',
  'js/html.js',
  'js/ui.js',
  'js/store.js',
  'js/github.js',
  'js/push.js',
  'js/views.js',
  'js/forms.js',
  'engine/remind.mjs',
  'engine/remind.yml',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('lab-planner-') && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// 同源资源：缓存优先（离线可用、版本一致）；GitHub API 等跨域请求不经过缓存
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (err) {
        if (req.mode === 'navigate') {
          const shell = await cache.match('index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : '' };
  }
  const title = d.title || '实验日程';
  const opts = {
    body: d.body || '打开看看今天的安排',
    tag: d.tag || 'lab-planner',
    renotify: true,
    icon: 'icons/icon-192.png',
    timestamp: d.ts || Date.now(),
    data: { url: d.url || './#/today' },
  };
  e.waitUntil(
    (async () => {
      await self.registration.showNotification(title, opts);
      try {
        if (typeof d.badge === 'number' && self.navigator.setAppBadge) {
          if (d.badge > 0) await self.navigator.setAppBadge(d.badge);
          else await self.navigator.clearAppBadge();
        }
      } catch {
        /* 不支持角标 */
      }
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './#/today', self.registration.scope).href;
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if (c.url.startsWith(self.registration.scope)) {
          await c.focus();
          if ('navigate' in c) {
            try {
              await c.navigate(url);
            } catch {
              /* 某些浏览器不允许 */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
