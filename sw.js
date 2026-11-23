/* ManteniPro 1.7 · Service Worker para notificaciones del sistema y soporte offline básico */
const CACHE_NAME = 'mantenipro-1-7-shell';
const APP_SCOPE = self.registration.scope;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.add(new Request(APP_SCOPE, { cache: 'reload' }));
    } catch (error) {
      // La instalación del SW no debe fallar si el hosting no permite precachear la ruta raíz.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('mantenipro-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request) || await caches.match(APP_SCOPE);
      if (cached) return cached;
      throw error;
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.url || APP_SCOPE;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if (data.jobId && 'postMessage' in client) client.postMessage({ type: 'MANTENIPRO_OPEN_JOB', jobId: data.jobId });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
