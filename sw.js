// FB Menus — service worker (guest menu offline support).
// • Admin panel and its code: never handled here (always live from the network).
// • Pages, JS and CSS: network first (updates show on the next visit),
//   saved copy used only when offline or the network is too slow.
// • Fonts, icons, vendor libraries: cache first (they never change).
// Supabase requests are never touched: menu data is cached by the app itself.

const BUILD = '2026-09-28-9';
const CACHE = `fbm-${BUILD}`;
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('fbm-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isAdmin = (req, url) =>
  url.pathname.includes('/admin/') ||
  url.pathname.includes('/assets/js/admin/') ||
  url.pathname.endsWith('/assets/css/admin.css') ||
  (req.referrer && new URL(req.referrer).pathname.includes('/admin/'));

const isStatic = (url) =>
  url.pathname.includes('/assets/fonts/') ||
  url.pathname.includes('/assets/vendor/') ||
  /\.(png|jpg|jpeg|webp|svg|ico|woff2?)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // Supabase, storage, etc.
  if (isAdmin(req, url)) return;                        // admin: always live
  event.respondWith(isStatic(url) ? cacheFirst(req) : networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }),               // revalidate with the server (cheap 304s)
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    return hit || fetch(req);
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
