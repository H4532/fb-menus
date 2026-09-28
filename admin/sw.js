// FB Menus admin — background worker for order notifications (Web Push).
// Shows notifications when the app is closed; tapping one opens the Orders tab.
// No fetch handling: the admin always loads live from the network.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'New order', body: event.data?.text() || '' }; }
  const title = data.title || 'New order';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag || undefined,
    renotify: true,
    requireInteraction: true,
    data: { url: new URL(data.url || './#orders', self.registration.scope).href },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        w.postMessage({ type: 'open-orders' });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
