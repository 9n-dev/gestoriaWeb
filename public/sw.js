// Service worker: web push only for now. Offline support and caching arrive with the PWA (phase 10).
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Portal de clientes', {
      body: data.body || '',
      data: { url: data.url || '/' },
      icon: '/api/branding/logo',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.url));
});
