// WatchParty Service Worker — "The Private Cinema"
// Handles Web Push room invites and PWA lifecycle events

const CACHE_NAME = 'watchparty-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming Web Push notifications (Phase 7.4)
self.addEventListener('push', (event) => {
  let data = {
    title: 'WatchParty Screening Invite',
    body: 'You have been invited to a private screening.',
    url: '/lobby',
    icon: '/icon-192.png',
    data: {},
  };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (_err) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const roomCode = data.data?.roomCode || data.roomCode;
  const targetUrl = data.url || (roomCode ? `/join/${roomCode}` : '/lobby');

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || (roomCode ? `room-invite-${roomCode}` : 'room-invite'),
    renotify: true,
    data: {
      roomCode,
      url: targetUrl,
      timestamp: Date.now(),
    },
    vibrate: [120, 40, 120],
    actions: [
      { action: 'join', title: 'Join Screening' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title || 'WatchParty Screening', options));
});

// Handle notification action clicks & tab focusing
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const targetUrl = event.notification.data?.url || '/lobby';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          try {
            const clientUrl = new URL(client.url);
            const destUrl = new URL(targetUrl, self.location.origin);
            if (clientUrl.pathname === destUrl.pathname) {
              return client.focus();
            }
          } catch (_e) {
            // URL parse fallback
          }
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
