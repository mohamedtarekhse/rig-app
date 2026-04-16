self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  const title = payload.title || 'Rigways Notification';
  const options = {
    body: payload.body || 'You have a new update.',
    tag: payload.tag || 'rigways-notification',
    data: {
      url: payload.url || '/notifications',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/notifications';
  event.waitUntil(clients.openWindow(targetUrl));
});
