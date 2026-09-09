/**
 * Item 7: installable, offline-capable service worker. Rewind's data
 * layer is already fully local-first (Dexie — lib/client/db.ts), so this
 * worker's only job is the APP SHELL: making sure the page, its JS/CSS,
 * and the icon are available with the network fully off, not just
 * "works offline after the first successful load".
 *
 * Deliberately hand-written rather than a Workbox/next-pwa dependency —
 * the shell-caching need here is small and well-bounded, and a few dozen
 * lines with an explicit, readable strategy beats a build plugin whose
 * generated output would be harder to reason about for this scope.
 *
 * `/api/*` is NEVER intercepted — sync must always hit the real network
 * (or fail fast so lib/client/sync-engine.ts's own retry/backoff takes
 * over), never a stale cached response pretending to be live server state.
 */
const CACHE_NAME = 'rewind-shell-v1'
const APP_SHELL = ['/', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Only ever handle our own GET requests. Cross-origin (fonts, etc.) and
  // any /api/* call pass straight through to the network untouched.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return
  }

  // Stale-while-revalidate: serve the cached shell instantly (this is
  // what makes a cold, fully-offline launch work), refresh the cache in
  // the background for next time.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request)
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone())
          return response
        })
        .catch(() => cached)
      return cached ?? network
    }),
  )
})
