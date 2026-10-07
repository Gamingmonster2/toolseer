/* ============================================================================
   ToolSeer service worker — small on purpose, auditable in one sitting.

   Its PRIMARY JOB IS TAKEOVER, not offline magic:

     1. install   → precache the shell, then skipWaiting() so a new worker
                    never waits behind an old one.
     2. activate  → delete every cache that is not in the current version list,
                    then clients.claim() so this worker controls the pages that
                    are already open.
     3. fetch     → navigations (HTML) are NETWORK-FIRST. A deploy is therefore
                    picked up on the next load. The cache is only ever read when
                    the network fails.

   WHY NETWORK-FIRST HTML MATTERS
   The audience we inherited installed the old Blogger page as an app. A worker
   that answers navigations from cache would pin those users to a stale copy of
   the old site — the exact opposite of "do not make them lose anything".

   HOW TO FORCE A STALE INSTALL TO UPDATE
   Bump VERSION below, ship it, and the activate step purges every older cache.
   The cache names are derived from VERSION, so an old worker's caches are never
   reused by a new one. Nothing else in this file needs to change.

   WHAT THIS WORKER NEVER DOES
     - never handles POST/PUT/DELETE (only GET is intercepted at all)
     - never touches another origin (cross-origin requests are left alone)
     - never touches non-http(s) schemes, so blob:/data: URLs — i.e. the user's
       own files, which the tools create locally — can never enter a cache
     - never caches a non-200, opaque, partial or `no-store` response
     - never caches /sw.js itself
     - never throws: every path falls back, and a failure degrades to "no cache"
       rather than to a broken page

   SUPPORT KILL SWITCH
   Visiting any URL with `?sw=off` unregisters this worker and deletes all caches
   on this origin, then serves a plain page telling the user to reload. Use it if
   a deploy ever leaves a device stuck; see docs/CONTINUITY.md.

   CSP NOTE: apps/web/_headers allows `worker-src 'self' blob:` and
   `connect-src 'self'`; this worker only ever fetches its own origin, and a
   worker served from /sw.js has scope `/` without any extra header.
   ========================================================================= */

'use strict';

/** Bump this to force every installed client off its old caches. */
const VERSION = 'v1';

/** Caches this version owns. Anything else is deleted on activate. */
const CACHE_NAMES = ['toolseer-shell-' + VERSION, 'toolseer-runtime-' + VERSION];
const SHELL_CACHE = CACHE_NAMES[0];
const RUNTIME_CACHE = CACHE_NAMES[1];

const OFFLINE_URL = '/offline.html';

/**
 * Precache list. Small, curated, and tolerant: a missing URL does not fail the
 * install (see precacheShell). It covers the hub, every tool route and the UI
 * modules those pages import, which is what makes an installed app open with
 * real chrome when the network is gone. The multi-megabyte PDF engines in
 * /vendor/ are deliberately NOT precached — they are cached on first real use.
 *
 * KEEP IN SYNC: when a new /assets/js/ui/*.js module is added, add it here.
 */
const PRECACHE = [
  OFFLINE_URL,
  '/',
  '/image-to-pdf',
  '/merge-pdf',
  '/compress-pdf',
  '/split-pdf',
  '/protect-pdf',
  '/unlock-pdf',
  '/pdf-to-images',
  '/organize-pdf',
  '/extract-text-pdf',
  '/desktop',
  '/privacy',
  '/terms',
  '/works',
  '/contact',
  '/assets/css/toolseer.css',
  '/assets/js/ui/shell.js',
  '/assets/js/ui/i18n.js',
  '/assets/js/ui/icons.js',
  '/assets/js/ui/toolkit.js',
  '/assets/js/ui/toolbox.js',
  '/assets/js/ui/pwa.js',
];

/**
 * Cache-first prefixes. Only URLs whose content is declared immutable or whose
 * filename encodes a new version belong here:
 *   /vendor/*    → `_headers` marks it `max-age=31536000, immutable`
 *   /assets/img/* → icons and mascots; replaced as a whole, small, no logic
 * Everything else under /assets/ (CSS and JS) is NOT cache-first: those URLs do
 * not change when their content changes, so pinning them would pair a fresh
 * HTML page with stale code after a deploy. They use network-first instead and
 * are still cached for offline use.
 */
const CACHE_FIRST_PREFIXES = ['/vendor/', '/assets/img/'];

/* --------------------------------------------------------------- utilities -- */

function isCacheFirst(pathname) {
  for (const prefix of CACHE_FIRST_PREFIXES) {
    if (pathname.indexOf(prefix) === 0) return true;
  }
  return false;
}

/** A response we are allowed to store. Anything else is passed through. */
function isCacheable(res) {
  if (!res || !res.ok || res.status !== 200) return false;
  if (res.type === 'opaque' || res.type === 'opaqueredirect' || res.type === 'error') return false;
  const cc = res.headers.get('cache-control') || '';
  if (cc.indexOf('no-store') !== -1) return false;
  return true;
}

/** cache.put that can never reject the caller. */
function putInCache(cacheName, request, response) {
  return caches
    .open(cacheName)
    .then((cache) => cache.put(request, response))
    .catch(() => false);
}

/** caches.match that can never reject (CacheStorage may be unavailable). */
function safeMatch(request, options) {
  return caches
    .match(request, options)
    .catch(() => null)
    .then((hit) => hit || null);
}

/** The key an HTML page is stored under: path only, so `?m=1` and tracking
    parameters (the old Blogger mobile variant) still hit the cached copy. */
function pageKey(url) {
  return new Request(url.origin + url.pathname);
}

/* ------------------------------------------------------------------ install -- */

function precacheShell() {
  return caches
    .open(SHELL_CACHE)
    .then((cache) =>
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {
            // A missing page must never fail the install; log and carry on.
            console.warn('[toolseer/sw] precache skipped (not available):', url);
          })
        )
      )
    )
    .catch(() => undefined);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheShell().then(() => self.skipWaiting().catch(() => undefined))
  );
});

/* ----------------------------------------------------------------- activate -- */

function purgeOldCaches() {
  return caches
    .keys()
    .then((names) =>
      Promise.all(
        names.map((name) => {
          if (CACHE_NAMES.indexOf(name) !== -1) return undefined;
          // CacheStorage is per-origin and ToolSeer is the only app here, so
          // every cache that is not from the current version is a leftover:
          // an older ToolSeer version, or a cache left by the legacy blob
          // worker. Both must go.
          return caches.delete(name).catch(() => false);
        })
      )
    )
    .catch(() => undefined);
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    purgeOldCaches()
      .then(() => self.clients.claim().catch(() => undefined))
  );
});

/* ------------------------------------------------------------------ fetches -- */

/** Network first; on failure fall back to the exact page, then the hub, then
    the offline page. Never rejects. */
function navigateNetworkFirst(request, url) {
  return fetch(request)
    .then((res) => {
      // Refresh the offline copy of this page, but only for a direct 200: a
      // redirected response (a legacy URL 301ing to the hub) is not stored
      // under the legacy path, because the hub is already cached as '/'.
      if (isCacheable(res) && !res.redirected) {
        return putInCache(RUNTIME_CACHE, pageKey(url), res.clone()).then(() => res);
      }
      return res;
    })
    .catch(() =>
      safeMatch(request, { ignoreSearch: true })
        .then((hit) => hit || safeMatch('/'))
        .then((hit) => hit || safeMatch(OFFLINE_URL))
        .then((hit) => hit || lastResortPage())
        .catch(() => lastResortPage())
    );
}

/** Cache first, used only for the immutable prefixes. */
function assetCacheFirst(request) {
  return safeMatch(request, { ignoreSearch: true }).then((hit) => {
    if (hit) return hit;
    return fetch(request)
      .then((res) => {
        if (isCacheable(res)) {
          return putInCache(RUNTIME_CACHE, request, res.clone()).then(() => res);
        }
        return res;
      })
      .catch(() => Response.error());
  });
}

/** Network first with a cached fallback: used for CSS, JS and anything else
    same-origin that is not covered by the two policies above. */
function assetNetworkFirst(request) {
  return fetch(request)
    .then((res) => {
      if (isCacheable(res)) {
        return putInCache(RUNTIME_CACHE, request, res.clone()).then(() => res);
      }
      return res;
    })
    .catch(() => safeMatch(request, { ignoreSearch: true }).then((hit) => hit || Response.error()));
}

/** Absolute last resort when even /offline.html is not cached. */
function lastResortPage() {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Offline — ToolSeer</title></head><body style="font-family:system-ui;padding:2rem">' +
      '<h1>You are offline</h1>' +
      '<p>ToolSeer could not reach the network and has no cached copy of this page yet.</p>' +
      '<p><a href="/">Try the hub again</a></p></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/* -------------------------------------------------------------- kill switch -- */

/** `?sw=off` — unregister and delete every cache on this origin. */
function disableSelf() {
  return caches
    .keys()
    .then((names) => Promise.all(names.map((name) => caches.delete(name).catch(() => false))))
    .catch(() => undefined)
    .then(() => self.registration.unregister().catch(() => false))
    .catch(() => false);
}

/**
 * The kill-switch response is built here rather than read from a cache: the
 * caches are being deleted in the same breath, so serving from them would race
 * the purge. It is plain HTML with no dependency on anything cached.
 */
function killSwitchPage() {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>ToolSeer — cache reset</title></head><body style="font-family:system-ui;padding:2rem">' +
      '<h1>ToolSeer cache reset</h1>' +
      '<p>The offline cache for this site has been cleared and the service worker has been ' +
      'unregistered. Reload this page to load everything fresh from the network.</p>' +
      '<p><a href="/">Go to ToolSeer</a></p></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/* ------------------------------------------------------------------- router -- */

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request) return;

  // Never intercept anything but a plain GET: POSTs carry user data and are
  // never cacheable.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Same origin only; http(s) only. blob:/data: are the user's own files.
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never let the worker cache itself.
  if (url.pathname === '/sw.js') return;

  // Partial content (Range) must not be stored: a cached 206 is not a full
  // response and would corrupt later reads. Leave those to the network.
  if (request.headers && request.headers.get('range')) return;

  // Kill switch, on any URL.
  if (url.searchParams.get('sw') === 'off') {
    event.waitUntil(disableSelf());
    event.respondWith(Promise.resolve(killSwitchPage()));
    return;
  }

  const isNavigation = request.mode === 'navigate' || request.destination === 'document';
  if (isNavigation) {
    event.respondWith(navigateNetworkFirst(request, url));
    return;
  }

  if (isCacheFirst(url.pathname)) {
    event.respondWith(assetCacheFirst(request));
    return;
  }

  event.respondWith(assetNetworkFirst(request));
});

/* ------------------------------------------------------- diagnostics channel -- */

/** Answer `{type:'toolseer:version'}` so a support session can see which worker
    is live: `navigator.serviceWorker.controller.postMessage({type:'toolseer:version'})` */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'toolseer:version') return;
  try {
    if (event.source && event.source.postMessage) {
      event.source.postMessage({ type: 'toolseer:version', version: VERSION, caches: CACHE_NAMES });
    }
  } catch {
    /* a diagnostic must never break anything */
  }
});
