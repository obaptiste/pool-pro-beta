const CACHE_NAME = 'pool-pro-shell-v2';
const APP_SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
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
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clonedResponse));
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
