/* ManteniPro 2.5 · Service Worker + Firebase Cloud Messaging.
   FCM background messages are data-only and displayed here to avoid duplicate notifications. */

// Register the click handler before importing Firebase Messaging, as recommended by Firebase.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const requested = new URL(data.url || './', self.location.href);
  const target = requested.origin === self.location.origin ? requested : new URL(self.registration.scope);
  if (data.jobId) target.searchParams.set('mpJobId', String(data.jobId));
  if (data.taskId) target.searchParams.set('mpTaskId', String(data.taskId));
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if (data.jobId) client.postMessage({ type: 'MANTENIPRO_OPEN_JOB', jobId: String(data.jobId) });
        if (data.taskId) client.postMessage({ type: 'MANTENIPRO_OPEN_TASK', taskId: String(data.taskId) });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target.href);
  })());
});

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAHTrIGeLC5Pl9vwIY3ok7WdAM5081VOcU',
  authDomain: 'mantenipro-1da42.firebaseapp.com',
  projectId: 'mantenipro-1da42',
  storageBucket: 'mantenipro-1da42.firebasestorage.app',
  messagingSenderId: '948648801124',
  appId: '1:948648801124:web:4c7d9360fc71d630784071'
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const data = payload.data || {};
  const title = String(data.title || payload.notification?.title || 'ManteniPro');
  const body = String(data.body || payload.notification?.body || 'Tienes un aviso pendiente.');
  return self.registration.showNotification(title, {
    body,
    tag: String(data.tag || 'mantenipro-push'),
    renotify: true,
    timestamp: Date.now(),
    data: {
      url: data.url || './',
      jobId: data.jobId || null,
      taskId: data.taskId || null
    },
    vibrate: [180, 80, 180]
  });
});

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
