// =============================================================================
// service-worker.js — Korean Vocabulary PWA
// Strategy: Cache-First with Network Fallback (Offline-First)
//
// CHANGES:
// - Sentence Mode: added ai-client, sentence-engine, sentence-store,
//   sentence-settings, sentence-mode (+ CSS) to PRECACHE_URLS
// - Bumped CACHE_VERSION
// =============================================================================

// ─── VERSION ─ bump this string on every deploy ──────────────────────────────
const CACHE_VERSION = '810d3ed';   
const CACHE_NAME    = `korean-vocab-${CACHE_VERSION}`;

// ---------------------------------------------------------------------------
// PRECACHE MANIFEST
// All files that must be available offline from the moment the SW installs.
// Update CACHE_NAME version string whenever this list changes.
// ---------------------------------------------------------------------------
const PRECACHE_URLS = [

  // ── Shell ─────────────────────────────────────────────────────────────────
  './',
  './index.html',
  './manifest.json',

  // ── Styles ────────────────────────────────────────────────────────────────
  './styles/base.css',
  './styles/themes.css',
  './styles/layout.css',

  // ── Screen-scoped stylesheets ─────────────────────────────────────────────
  './styles/screens/main-menu.css',
  './styles/screens/session-settings.css',
  './styles/screens/main-game.css',
  './styles/screens/flashcard.css',
  './styles/screens/master-deck.css',
  './styles/screens/session-summary.css',
  './styles/screens/options.css',
  './styles/screens/custom-word.css',
  './styles/screens/spelling-options.css',
  './styles/screens/spelling-flashcard.css',
  './styles/screens/spelling-wordsearch.css',
  './styles/screens/onboarding.css',
  './styles/screens/login.css',
  './styles/screens/sentence-settings.css',
  './styles/screens/sentence-mode.css',

  // ── Core ──────────────────────────────────────────────────────────────────
  './core/router.js',
  './core/state.js',
  './core/utils.js',
  './core/auth.js',
  './core/ai-client.js',
  
  // ── DB layer ──────────────────────────────────────────────────────────────
  './db/db.js',
  './db/word-store.js',
  './db/session-store.js',
  './db/settings-store.js',
  './db/sentence-store.js',
  './db/sync-engine.js',

  // ── Engine ────────────────────────────────────────────────────────────────
  './engine/srs.js',
  './engine/spawner.js',
  './engine/speed-controller.js',
  './engine/phase-manager.js',
  './engine/progression.js',
  './engine/spawn-rate.js',
  './engine/word-streak.js',
  './engine/sentence-engine.js',
  
  // ── Screens ───────────────────────────────────────────────────────────────
  './screens/main-menu.js',
  './screens/session-settings.js',
  './screens/flashcard-options.js',
  './screens/main-game.js',
  './screens/flashcard-mode.js',
  './screens/master-deck.js',
  './screens/session-summary.js',
  './screens/options.js',
  './screens/custom-word.js',
  './screens/spelling-options.js',
  './screens/spelling-flashcard.js',
  './screens/spelling-wordsearch.js',
  './screens/onboarding.js',
  './screens/sentence-settings.js',
  './screens/sentence-mode.js',

  // ── Vocab data files ──────────────────────────────────────────────────────
  './vocab/vocab.js',
  './vocab/unit1_data.js',
  './vocab/unit2_data.js',

  // ── Assets ────────────────────────────────────────────────────────────────
  './assets/sounds/sounds.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',

];

// =============================================================================
// INSTALL — precache every listed file atomically.
// =============================================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // NOTE: cache.addAll() uses default fetch() caching behavior, which
      // means it can be served stale bytes from the browser's HTTP cache
      // even when this is a brand new CACHE_NAME. { cache: 'reload' }
      // forces every precache request to bypass the HTTP cache and hit
      // the network directly, so updates are actually picked up without
      // users having to clear all local site data.
      const requests = PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }));
      await Promise.all(
        requests.map(async (req) => {
          try {
            const response = await fetch(req);
            if (response && (response.status === 200 || response.status === 0)) {
              await cache.put(req, response);
            }
          } catch (err) {
            console.warn('[SW] Precache failed for', req.url, err);
          }
        })
      );
    })
  );
});

// =============================================================================
// ACTIVATE — purge every cache whose key no longer matches CACHE_NAME.
// =============================================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        const deletionPromises = cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((staleName) => {
            console.log(`[SW] Deleting stale cache: ${staleName}`);
            return caches.delete(staleName);
          });
        return Promise.all(deletionPromises);
      })
      .then(() => {
        return self.clients.claim();
      })
  );
});

// =============================================================================
// MESSAGE — receives commands from the app UI (options.js).
// =============================================================================
self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data) {

    case 'SKIP_WAITING':
      console.log('[SW] SKIP_WAITING received — activating new SW immediately');
      self.skipWaiting();
      break;

    case 'CLEAR_APP_CACHE':
      // Deprecated — the activate handler already deletes all stale caches.
      // We keep the case so old clients don't throw, but it is now a no-op.
      console.log('[SW] CLEAR_APP_CACHE received (noop — activate handler handles stale cache cleanup)');
      break;

    case 'GET_VERSION':
      if (event.source) {
        event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION, cacheName: CACHE_NAME });
      }
      break;

    default:
      console.warn('[SW] Unknown message received:', event.data);
  }
});

// =============================================================================
// FETCH — Cache-First strategy.
// =============================================================================
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = event.request.url;

  // Only handle http/https requests — chrome-extension://, blob:, data:, etc.
  // cannot be stored via the Cache API and will throw on cache.put().
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return;
  }

  if (url.includes('firestore.googleapis.com') || 
      url.includes('firebase.googleapis.com') ||
      url.includes('identitytoolkit.googleapis.com') ||
      url.includes('securetoken.googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        const isCacheable =
          networkResponse &&
          (networkResponse.status === 200 || networkResponse.status === 0);

        if (!isCacheable) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();

        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(event.request, responseToCache))
          .catch((err) => console.warn('[SW] Cache put failed:', err));

        return networkResponse;
      });
    })
  );
});
