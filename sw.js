/* ManteniPro Service Worker: system notifications and Web Push receiver. */
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : '' }; }
  const title = payload.title || 'ManteniPro';
  const options = {
    body: payload.body || 'Tienes un aviso pendiente.',
    icon: payload.icon || './icon-192.png',
    badge: payload.badge || './icon-192.png',
    tag: payload.tag || 'mantenipro-push',
    renotify: true,
    data: payload.data || { url: './' },
    vibrate: [180, 80, 180]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.url || './';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) { await client.focus(); if (data.jobId) client.postMessage({ type: 'MANTENIPRO_OPEN_JOB', jobId: data.jobId }); if (data.taskId) client.postMessage({ type: 'MANTENIPRO_OPEN_TASK', taskId: data.taskId }); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
