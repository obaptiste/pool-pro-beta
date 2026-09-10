/// <reference lib="webworker" />
// Built by vite-plugin-pwa (injectManifest strategy — see vite.config.ts).
// The precache manifest below is generated at build time from dist/, so
// this file never has to discover which hashed bundles index.html
// references at runtime, and every deploy that changes any asset also
// changes the emitted sw.js — which is what actually makes the browser
// install the update.
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { googleFontsCache } from 'workbox-recipes';

declare let self: ServiceWorkerGlobalScope;

// Caches written by the hand-rolled service worker this file replaced.
// Workbox only cleans up its own outdated precaches, so these would
// otherwise sit in storage (and keep serving nothing) forever.
const LEGACY_CACHE_PREFIX = 'pool-pro-shell-';

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith(LEGACY_CACHE_PREFIX)).map((key) => caches.delete(key))),
    ),
  );
});

// SPA navigations always get the precached shell. API routes and the
// Firebase reserved namespace are real server endpoints, not app pages.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/__\//],
  }),
);

googleFontsCache();
