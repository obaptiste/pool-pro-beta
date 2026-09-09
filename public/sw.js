const CACHE_NAME = 'pool-pro-shell-v2';
const APP_SHELL = ['/', '/index.html'];

// Precache the hashed JS/CSS this shell actually references, not just the
// shell itself. Activation below evicts every older cache (v1's included),
// so if a device goes offline before it has organically requested the new
// bundle, an app shell with no matching assets to serve would leave it
// unable to start at all.
async function precacheShellAssets(cache) {
  try {
    const indexResponse = await cache.match('/index.html');
    if (!indexResponse) return;
    const html = await indexResponse.clone().text();
    const assetUrls = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g), (m) => m[1]);
    if (assetUrls.length) {
      await cache.addAll(assetUrls);
    }
  } catch {
    // Best-effort: the asset fetch handler below will cache these lazily
    // on first request if precaching fails for any reason.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      await precacheShellAssets(cache);
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

// Navigation/HTML requests are network-first: an app-shell response served
// from cache can silently keep users on a stale JS bundle indefinitely,
// since browsers only install a new service worker when this file's bytes
// change, not when the app's own code changes. Falling back to cache only
// covers being offline. Hashed static assets (JS/CSS) are safe to serve
// cache-first — their filenames change whenever their content does.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const isNavigation = event.request.mode === 'navigate' || event.request.destination === 'document';

  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const clonedResponse = networkResponse.clone();
            // Keep the worker alive until the cache write finishes — without
            // waitUntil, respondWith settles as soon as networkResponse is
            // returned and the worker can be killed mid-write, leaving a
            // subsequent offline launch stuck with the stale cached shell.
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clonedResponse)));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          const isHttp = event.request.url.startsWith('http');
          const isAssetRequest = event.request.destination === 'script' || event.request.destination === 'style';

          if (isHttp && isAssetRequest && networkResponse.ok) {
            const clonedResponse = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clonedResponse));
          }

          return networkResponse;
        })
        .catch(() => new Response('Offline', { status: 503, statusText: 'Offline' }));
    }),
  );
});
