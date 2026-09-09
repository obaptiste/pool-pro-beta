const CACHE_NAME = 'pool-pro-shell-v2';

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
      const { pathname } = new URL(request.url);
      // Hashed assets aren't HTML documents to scan, and the generation
      // markers below aren't either — they're plain numeric timestamps.
      if (pathname.startsWith('/assets/') || pathname.startsWith('/__sw_generation__')) return;
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
// that no longer exist. A newly-installing worker's staging→live
// promotion is exactly the same hazard again: it runs in a completely
// separate global scope from whatever worker is still active and
// handling navigations, so an in-memory queue alone can't coordinate
// between them — each worker instance would hold its own, unconnected
// queue object. The Web Locks API is the browser's actual primitive for
// this: a named lock serializes every holder across origin-wide contexts,
// active worker and installing worker included, not just within one.
// Falls back to an in-memory, single-instance queue where Web Locks isn't
// available — still correct for concurrent navigations within one worker,
// just not across a worker update in progress.
const CACHE_UPDATE_LOCK = 'pool-pro-shell-cache-update';
let cacheUpdateQueue = Promise.resolve();
function serializeCacheUpdate(task) {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(CACHE_UPDATE_LOCK, task);
  }
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
// order they started in.
//
// An in-memory "highest sequence number per key" map has the same problem
// Web Locks fixed above: it's module-scoped, so a still-active old worker
// and a newly-installing one don't share it — an old worker's navigation
// that was already in flight when a redeploy happened can resolve *after*
// the new worker finished promoting its shell, see nothing in its own
// local map saying otherwise, and revert the just-published shell to
// stale content. What actually needs comparing is durable and shared: a
// timestamp (comparable across any execution context on this device,
// unlike a per-instance counter) persisted *in the cache itself*, read
// and written under the same lock every transaction already takes above —
// so "is this claim newer than the last one this key saw" is answered
// from state every worker instance, old or new, actually shares.
function generationKeyFor(key) {
  return `/__sw_generation__?key=${encodeURIComponent(key)}`;
}

// Date.now() can jump backward if the device's wall clock is corrected
// (NTP sync after a wrong date, a user fixing a stuck RTC) — once that
// happens, every future claim would compare against a generation value
// stamped using the old, artificially-advanced clock and lose, freezing
// the offline shell indefinitely until wall time caught back up.
// performance.now() is monotonic and immune to such corrections within a
// context's lifetime; timeOrigin anchors it to an absolute, comparable
// value (still just as good as Date.now() for comparing across separate
// worker instances, since both derive from the same underlying clock at
// each context's creation).
function monotonicTimestamp() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}

async function claimIfNewer(cache, key, timestamp) {
  const existing = await cache.match(generationKeyFor(key));
  const existingTimestamp = existing ? Number(await existing.text()) : 0;
  if (timestamp <= existingTimestamp) return false;
  await cache.put(generationKeyFor(key), new Response(String(timestamp)));
  return true;
}

// A future edit to this file that keeps CACHE_NAME unchanged (easy to
// forget — nothing enforces bumping it) would otherwise have install open
// the very cache the currently-active worker may still be serving live
// requests from, and start overwriting "/" and "/index.html" in place
// before their assets are confirmed cached. Failing that install (per the
// asset-precache guarantee above) stops the new worker from activating,
// but can't undo a cache write that already happened — so the live cache
// would be left with HTML referencing assets that were never actually
// cached, breaking offline start even under the previously-active worker.
// Building the new shell in an isolated staging cache first, and only
// publishing it into CACHE_NAME once every asset is confirmed cached,
// keeps a failed install from touching the live cache at all.
const STAGING_CACHE_NAME = `${CACHE_NAME}-staging`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Captured before any of this install's own network activity, for
      // the same reason a navigation captures its timestamp before its
      // fetch (above): staging this shell (network fetches for APP_SHELL
      // plus its assets) and then waiting for the promotion lock can both
      // take a while, and a navigation on the currently-active worker can
      // fetch and commit a *later* deploy in that window. Timestamping at
      // promotion time instead would make this stale content look newer
      // than what that navigation already correctly published, purely
      // because the wait for the lock happened to run late.
      const timestamp = monotonicTimestamp();
      await caches.delete(STAGING_CACHE_NAME); // leftover from an earlier failed install, if any
      const staging = await caches.open(STAGING_CACHE_NAME);
      // Fetch the shell once and stage it under both APP_SHELL aliases,
      // rather than two independent requests (cache.addAll would issue
      // one per URL): if a deploy cutover happened to straddle those two
      // fetches — landing on different edge nodes mid-propagation — they
      // could each return a different deployment's HTML, and only one of
      // them would get its assets precached below, leaving the other
      // alias pointing at bundles that were never staged.
      const shellResponse = await fetch('/index.html');
      if (!shellResponse.ok) throw new Error(`Failed to fetch app shell: ${shellResponse.status}`);
      await staging.put('/index.html', shellResponse.clone());
      await staging.put('/', shellResponse.clone());
      // Deliberately not caught: if precaching the shell's own assets
      // fails, this install should fail and retry rather than promote
      // (skipWaiting below) a shell with nothing to run offline.
      const indexResponse = await staging.match('/index.html');
      await cacheReferencedAssets(staging, indexResponse);

      // Only now, with the staged shell fully built and verified, publish
      // it into the live cache — through the same queue navigation
      // transactions use, so this can't interleave with one of those.
      await serializeCacheUpdate(async () => {
        const live = await caches.open(CACHE_NAME);
        const staged = await staging.keys();
        const [assetEntries, shellEntries] = [
          staged.filter((request) => new URL(request.url).pathname.startsWith('/assets/')),
          staged.filter((request) => !new URL(request.url).pathname.startsWith('/assets/')),
        ];
        // Claim generation for each shell key up front. An old worker's
        // navigation that was already in flight when this deploy went out
        // can otherwise resolve after this install finishes and revert
        // the shell it just published — claiming here first means a
        // later, genuinely-stale claim from that old navigation loses
        // against this timestamp instead of silently winning.
        const claims = new Map();
        for (const request of shellEntries) {
          const key = new URL(request.url, request.url).href;
          claims.set(request, await claimIfNewer(live, key, timestamp));
        }
        if (![...claims.values()].some(Boolean)) return; // everything here is already stale relative to something newer already live
        // Copy assets before shell documents, sequentially rather than in
        // parallel: this cache has no multi-key transaction, so a
        // mid-batch failure (e.g. storage quota, momentarily doubled by
        // staging + live both holding a copy) can't be rolled back. If a
        // copy fails partway through, failing before any shell entry is
        // written keeps the live cache's HTML from ever pointing at an
        // asset it doesn't actually have — same ordering guarantee used
        // for navigation-triggered updates above, just applied here too.
        for (const request of assetEntries) {
          const response = await staging.match(request);
          await live.put(request, response);
        }
        for (const [request, isClaimed] of claims) {
          if (!isClaimed) continue;
          const response = await staging.match(request);
          await live.put(request, response);
        }
        await pruneStaleAssets(live);
      });
      await caches.delete(STAGING_CACHE_NAME);
    })(),
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
    // Captured synchronously, at navigation *start* — reflects real
    // arrival order regardless of how long the network fetch below takes,
    // and (unlike a per-instance counter) is directly comparable against
    // a claim made by any other execution context on this device.
    const timestamp = monotonicTimestamp();
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // request.mode is "navigate" for ANY top-level browser
          // navigation, regardless of what the URL actually serves — a
          // direct visit to /sw.js or a hashed JS bundle is a navigation
          // too. Only a response whose own Content-Type says it's HTML is
          // safe to promote to the app shell; anything else (production
          // serves static files directly, so this isn't hypothetical) is
          // returned to the browser as-is without touching the cache.
          const isHtml = (networkResponse.headers.get('content-type') || '').includes('text/html');
          if (networkResponse.ok && isHtml) {
            const forAssets = networkResponse.clone();
            const forRequestKey = networkResponse.clone();
            const forCanonical = networkResponse.clone();
            const forRoot = networkResponse.clone();
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
                  // (or "/") must contend on one identity, not two, or a
                  // stale claim on its "own" key can silently win back the
                  // very entry a newer navigation's canonical claim just
                  // correctly denied it.
                  const requestKeyId = new URL(event.request.url, event.request.url).href;
                  const canonicalKeyId = new URL('/index.html', event.request.url).href;
                  const rootKeyId = new URL('/', event.request.url).href;
                  const claimedRequestKey = await claimIfNewer(cache, requestKeyId, timestamp);
                  // Also refresh the canonical /index.html fallback used
                  // below when offline at a URL that was never explicitly
                  // requested online (or wasn't the one just fetched), and
                  // the "/" alias APP_SHELL seeded at install — otherwise
                  // either stays frozen at whatever was last cached when
                  // this worker itself was installed, and an offline exact-
                  // match lookup on that stale "/" would never even reach
                  // the (correctly fresh) canonical fallback.
                  const claimedCanonical = await claimIfNewer(cache, canonicalKeyId, timestamp);
                  const claimedRoot = rootKeyId === requestKeyId ? claimedRequestKey : await claimIfNewer(cache, rootKeyId, timestamp);
                  if (!claimedRequestKey && !claimedCanonical && !claimedRoot) {
                    // A navigation that started after this one already won
                    // every key this one would write to — its result is
                    // stale by the time it arrived, so leave the newer
                    // shell already in the cache alone.
                    return;
                  }
                  await cacheReferencedAssets(cache, forAssets);
                  if (claimedRequestKey) await cache.put(event.request, forRequestKey);
                  if (claimedCanonical) await cache.put('/index.html', forCanonical);
                  if (claimedRoot && rootKeyId !== requestKeyId) await cache.put('/', forRoot);
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
