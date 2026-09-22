const CACHE = 'shu-campus-v3';
const TILE = 'shu-tiles-v2';
const CORE = ['./', './index.html', './manifest.webmanifest',
              './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

async function addAll(c, urls) {
  for (let i = 0; i < urls.length; i += 16) {
    await Promise.all(urls.slice(i, i + 16).map(async u => {
      try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await c.put(u, r); } catch (e) {}
    }));
  }
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await addAll(c, CORE);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE && k !== TILE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

async function trimTiles(c) {
  const keys = await c.keys();
  if (keys.length > 3000) for (let i = 0; i < keys.length - 3000; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 联网时在线瓦片走缓存优先 + 后台更新（离线则用本地 tiles/ 兜底）
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith((async () => {
      const c = await caches.open(TILE);
      const hit = await c.match(req);
      if (hit) {
        fetch(req).then(r => { if (r.ok) c.put(req, r.clone()).then(() => trimTiles(c)); }).catch(() => {});
        return hit;
      }
      try {
        const r = await fetch(req);
        if (r.ok) c.put(req, r.clone()).then(() => trimTiles(c));
        return r;
      } catch (err) { return new Response('', { status: 504 }); }
    })());
    return;
  }

  // 同源资源（含本地 tiles/）：缓存优先，离线回退首页
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok) c.put(req, r.clone());
        return r;
      } catch (err) {
        const idx = await c.match('./index.html');
        return idx || new Response('离线且无缓存', { status: 503 });
      }
    })());
  }
});
