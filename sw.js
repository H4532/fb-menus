// FB Menus — service worker.
// Pages: network first, fall back to cache (fresh when online, still opens offline).
// Static assets (css/js/fonts/icons): cache first — they are versioned by BUILD.
// Supabase requests are never touched: menu data is cached by the app itself.
// Bump BUILD whenever you deploy changed CSS/JS so phones pick up the new files.

const BUILD = '2026-09-28-3';
const CACHE = `fbm-${BUILD}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('fbm-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // Supabase, storage, etc.
  if (url.pathname.includes('/admin/')) return;           // admin always live

  const isPage = req.mode === 'navigate' || req.destination === 'document';
  event.respondWith(isPage ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
