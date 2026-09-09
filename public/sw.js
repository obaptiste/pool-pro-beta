const CACHE_NAME = 'pool-pro-shell-v2';
const APP_SHELL = ['/', '/index.html'];

function extractAssetUrls(html) {
  return Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g), (m) => m[1]);
}

// Cache the hashed JS/CSS an HTML shell references, returning the URLs
// cached. Callers must do this *before* committing that HTML as the cached
// shell (below) — if asset caching fails partway through, whatever shell
// was already cached (still pointing at its own, still-cached assets)
// should stay the one served offline, rather than a newer HTML with
// nothing to run.
async function cacheReferencedAssets(cache, htmlResponse) {
  const html = await htmlResponse.clone().text();
  const assetUrls = extractAssetUrls(html);
  if (assetUrls.length) {
    await cache.addAll(assetUrls);
  }
  return assetUrls;
}

// Every hashed asset referenced by any HTML document currently in the
// cache (not just the one most recently committed) — e.g. "/" and
// "/index.html" normally stay identical, but nothing here assumes only
// one distinct navigation URL is ever cached.
async function collectReferencedAssets(cache) {
  const requests = await cache.keys();
  const referenced = new Set();
  await Promise.all(
    requests.map(async (request) => {
      if (new URL(request.url).pathname.startsWith('/assets/')) return;
      const response = await cache.match(request);
      if (!response) return;
      const html = await response.clone().text();
      for (const url of extractAssetUrls(html)) referenced.add(url);
    }),
  );
  return referenced;
}

// Delete any cached hashed asset no longer referenced by any HTML document
// still in the cache. Without this, a run of deploys that never happen to
// change sw.js itself (so activate/eviction never runs) would keep
// appending every historical bundle to the same cache forever, until
// storage quota pressure makes further cache writes fail outright and
// offline support stops updating for good.
async function pruneStaleAssets(cache) {
  const keep = await collectReferencedAssets(cache);
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter((request) => {
        const path = new URL(request.url).pathname;
        return path.startsWith('/assets/') && !keep.has(path);
      })
      .map((request) => cache.delete(request)),
  );
}

// Two tabs can navigate at once, each running its own independent "cache
// assets, commit HTML, prune" transaction against the same shared cache.
// Interleaved (not serialized), one navigation's prune can run between
// another's asset-caching and HTML-commit steps and delete assets the
// other is about to reference, or a slower, older-deploy response can
// commit after a newer one and prune the newer bundle out from under the
// shell it just wrote — either way leaving cached HTML pointing at assets
// that no longer exist. Routing every such transaction through this
// single, module-scoped queue makes them run one at a time, in full, so
// each one always sees a self-consistent cache and never observes (or
// leaves behind) a shell whose assets were pruned mid-transaction.
let cacheUpdateQueue = Promise.resolve();
function serializeCacheUpdate(task) {
  const result = cacheUpdateQueue.then(task, task);
  // Chain the next task off this one regardless of outcome, so one
  // rejected transaction doesn't wedge every transaction queued after it.
  cacheUpdateQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}

// Serialization alone only stops transactions from corrupting each other —
// it doesn't stop an older, slower navigation from committing *after* a
// newer one and reverting a cache key to stale content, since transactions
// run in whatever order their network fetches happen to resolve, not the
// order they started in. Track each cache key's highest sequence number
// (assigned when its navigation *started*, not when it resolved) and only
// let a write through if it's newer than whatever last won that key, so a
// late-arriving response from an older deploy can't stomp a newer one that
// already committed. Two independent navigation URLs never contend for
// each other's key, only for the shared canonical "/index.html" fallback.
const latestSeqByKey = new Map();
function claimIfNewer(key, seq) {
  if (seq <= (latestSeqByKey.get(key) ?? 0)) return false;
  latestSeqByKey.set(key, seq);
  return true;
}
let navigationSeq = 0;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      // Deliberately not caught: if precaching the shell's own assets
      // fails, this install should fail and retry rather than activate
      // (skipWaiting below) into a shell with nothing to run offline.
      const indexResponse = await cache.match('/index.html');
      await cacheReferencedAssets(cache, indexResponse);
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
    // Assigned synchronously, at navigation *start* — reflects real arrival
    // order regardless of how long the network fetch below takes.
    const seq = ++navigationSeq;
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const forAssets = networkResponse.clone();
            const forRequestKey = networkResponse.clone();
            const forCanonical = networkResponse.clone();
            // Keep the worker alive until this finishes — without waitUntil,
            // respondWith settles as soon as networkResponse is returned and
            // the worker can be killed mid-write. This also covers deploys
            // that don't change sw.js at all (so no new install/precache
            // ever runs): the assets a fresh index.html references are
            // cached here before that HTML replaces the previously cached
            // shell, never after — so an interruption leaves the old,
            // still-complete shell in place rather than a broken new one.
            event.waitUntil(
              serializeCacheUpdate(() =>
                caches.open(CACHE_NAME).then(async (cache) => {
                  // Normalized to the same absolute form cache.put() actually
                  // addresses: a navigation whose own request IS "/index.html"
                  // must contend on one identity, not two, or a stale claim on
                  // its "own" key can silently win back the very entry a
                  // newer navigation's canonical claim just correctly denied it.
                  const requestKeyId = new URL(event.request.url, event.request.url).href;
                  const canonicalKeyId = new URL('/index.html', event.request.url).href;
                  const claimedRequestKey = claimIfNewer(requestKeyId, seq);
                  // Also refresh the canonical /index.html fallback used
                  // below when offline at a URL that was never explicitly
                  // requested online (or wasn't the one just fetched) —
                  // otherwise it stays frozen at whatever was last cached
                  // when this worker itself was installed.
                  const claimedCanonical = claimIfNewer(canonicalKeyId, seq);
                  if (!claimedRequestKey && !claimedCanonical) {
                    // A navigation that started after this one already won
                    // every key this one would write to — its result is
                    // stale by the time it arrived, so leave the newer
                    // shell already in the cache alone.
                    return;
                  }
                  await cacheReferencedAssets(cache, forAssets);
                  if (claimedRequestKey) await cache.put(event.request, forRequestKey);
                  if (claimedCanonical) await cache.put('/index.html', forCanonical);
                  // Prune only after every retained HTML document (this one
                  // included) has its own assets safely cached, and scan all
                  // of them — not just this one — so an asset still
                  // referenced by some other still-cached page never gets
                  // deleted out from under it.
                  await pruneStaleAssets(cache);
                }),
              ),
            );
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
