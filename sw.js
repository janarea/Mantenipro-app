/* ManteniPro 2.5 · receptor de notificaciones del sistema y Web Push.
   Importante: el Service Worker no programa alarmas locales por sí solo.
   Para recibir avisos con la app cerrada se necesita una suscripción Push
   y un servidor que envíe mensajes Web Push (VAPID). */
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil((async () => { await self.clients.claim(); })()); });

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      if (event.data) {
        try { payload = event.data.json() || {}; }
        catch (_) { payload = { body: event.data.text() || '' }; }
      }
    } catch (_) { payload = {}; }
    const title = String(payload.title || 'ManteniPro');
    const data = (payload.data && typeof payload.data === 'object') ? payload.data : {};
    if (!data.url) data.url = './';
    const options = {
      body: String(payload.body || 'Tienes un aviso pendiente.'),
      tag: String(payload.tag || 'mantenipro-push'),
      renotify: true,
      timestamp: Date.now(),
      data,
      vibrate: [180, 80, 180]
    };
    if (payload.icon) options.icon = payload.icon;
    if (payload.badge) options.badge = payload.badge;
    if (Array.isArray(payload.actions)) options.actions = payload.actions.slice(0, 2);
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || './', self.location.href);
  // Nunca permitir que un payload externo navegue fuera del origen de la PWA.
  const safeTarget = target.origin === self.location.origin ? target.href : self.registration.scope;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if (data.jobId) client.postMessage({ type: 'MANTENIPRO_OPEN_JOB', jobId: data.jobId });
        if (data.taskId) client.postMessage({ type: 'MANTENIPRO_OPEN_TASK', taskId: data.taskId });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(safeTarget);
  })());
});
