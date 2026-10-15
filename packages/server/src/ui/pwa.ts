/**
 * Progressive Web App (PWA) Manifest, Service Worker & Offline Shell Provider
 * Optimized for mobile homescreen installation, zero-network fallback, and background recovery.
 */

export function getManifestJson(): string {
  return JSON.stringify(
    {
      name: "WatchParty - Synchronized Video & Co-Watching",
      short_name: "WatchParty",
      description: "Ultra-low latency synchronized watch party with friends",
      start_url: "/app",
      scope: "/",
      display: "standalone",
      display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
      background_color: "#090d16",
      theme_color: "#090d16",
      orientation: "any",
      categories: ["entertainment", "video", "social"],
      icons: [
        {
          src: "/icon-192.svg",
          sizes: "192x192",
          type: "image/svg+xml",
          purpose: "any",
        },
        {
          src: "/icon-512.svg",
          sizes: "512x512",
          type: "image/svg+xml",
          purpose: "any",
        },
        {
          src: "/icon-512.svg",
          sizes: "512x512",
          type: "image/svg+xml",
          purpose: "maskable",
        },
      ],
      shortcuts: [
        {
          name: "Join Room",
          short_name: "Join",
          url: "/app?action=join",
          description: "Join an active watch party with a room code",
        },
        {
          name: "Create Room",
          short_name: "Host",
          url: "/app?action=create",
          description: "Start a new watch party for friends",
        },
      ],
    },
    null,
    2
  );
}

export function getServiceWorkerJs(): string {
  return `// WatchParty Service Worker v1.0.0
const CACHE_NAME = 'watchparty-shell-v1';
const OFFLINE_URL = '/offline.html';

const SHELL_ASSETS = [
  '/',
  '/app',
  '/offline.html',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.warn('[SW] Caching shell assets failed:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip WebSocket, API, and cross-origin requests
  if (req.method !== 'GET' || url.pathname.startsWith('/api/') || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // HTML navigation requests: network first with offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          // Cache latest app shell on successful navigation
          if (networkRes.ok && (url.pathname === '/' || url.pathname === '/app' || url.pathname.startsWith('/join/'))) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          const fallback = await caches.match(OFFLINE_URL);
          return fallback || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        })
    );
    return;
  }

  // Static assets (fonts, icons, manifest): Cache first, fallback to network
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((networkRes) => {
        if (networkRes.ok && (url.origin === self.location.origin || url.hostname.includes('fonts.gstatic.com'))) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkRes;
      }).catch(() => {
        // Return 404 for missing cached resources
        return new Response(null, { status: 404 });
      });
    })
  );
});

// Web Push Notifications
self.addEventListener('push', (event) => {
  let data = { title: 'WatchParty', body: 'New notification', url: '/app' };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.svg',
    badge: '/icon-192.svg',
    data: { url: data.url || '/app' },
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'Open Party' }
    ]
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/app';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes(targetUrl) || (targetUrl === '/app' && client.url.includes('/app'))) {
            return client.focus();
          }
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
`;
}

export function getOfflineHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>WatchParty - Offline</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #121826;
      --primary: #6366f1;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      text-align: center;
    }
    .offline-card {
      background: var(--card);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 2.5rem 2rem;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }
    .icon {
      font-size: 3.5rem;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: var(--text-muted);
      font-size: 0.95rem;
      line-height: 1.5;
      margin-bottom: 1.75rem;
    }
    button {
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0.75rem 1.75rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      min-height: 48px;
      width: 100%;
      transition: background 0.2s ease;
    }
    button:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <div class="offline-card">
    <div class="icon">📡</div>
    <h1>You are Offline</h1>
    <p>WatchParty requires an active internet connection to synchronize videos and chat with your friends. Check your Wi-Fi or cellular connection.</p>
    <button onclick="window.location.reload()">Retry Connection</button>
  </div>
</body>
</html>`;
}

export function getAppIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#06b6d4" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="128" fill="#090d16"/>
  <circle cx="256" cy="256" r="180" fill="url(#grad)" filter="url(#shadow)"/>
  <polygon points="220,170 340,256 220,342" fill="#ffffff"/>
  <circle cx="360" cy="150" r="18" fill="#ec4899"/>
  <circle cx="150" cy="360" r="14" fill="#10b981"/>
</svg>`;
}
