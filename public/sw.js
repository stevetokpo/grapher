// Service worker Grapher — réception des notifications push.
// Enregistré par lib/notifyClient.js. Sert uniquement au push : aucun cache,
// aucune interception de requête (l'app reste servie normalement par Next).

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* payload non-JSON */ }

  const title = data.title || 'Grapher';
  event.waitUntil(
    self.registration.showNotification(title, {
      body:    data.body || '',
      // Même tag ⇒ la nouvelle notif d'une alerte remplace la précédente au
      // lieu d'empiler.
      tag:     data.tag || 'grapher',
      data:    data.data || {},
      icon:    '/favicon.ico',
      badge:   '/favicon.ico',
      requireInteraction: true,   // reste affichée jusqu'à ce que tu la lises
    })
  );
});

// Clic sur la notif → focalise un onglet Grapher existant, sinon en ouvre un.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
