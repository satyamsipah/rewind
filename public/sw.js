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
 *
 * THREE strategies, because the shell is not one kind of thing:
 *
 * - **The HTML document: network-first.** It is the mutable index that
 *   names the content-hashed chunk files, so serving it from cache hands
 *   the browser a stale map: it then asks for the PREVIOUS build's chunk
 *   hashes, which are also cached, and the user runs the previous build
 *   in full. (v1 used stale-while-revalidate here, which put every user
 *   exactly one deploy behind on their first load after a release — it
 *   corrected on the second load, once the background revalidate had
 *   replaced the cached HTML.) Falling back to cache when the network
 *   genuinely fails is what still makes a cold offline launch work.
 * - **`/_next/static/*`: cache-first.** Content-hashed and therefore
 *   immutable — a matching URL is a matching body, so there is nothing to
 *   revalidate and a cache hit is always correct.
 * - **Everything else same-origin: stale-while-revalidate.** The icon and
 *   manifest, which are neither the entry point nor content-hashed, and
 *   where staleness costs nothing.
 */
const CACHE_NAME = 'rewind-shell-v2'
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

/** The document: always prefer the network, so a released build is picked
 * up on the very next load. Offline, fall back to the cached shell — any
 * route falls back to '/', the only document this SPA serves. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    return (await cache.match(request)) ?? (await cache.match('/')) ?? Response.error()
  }
}

/** Immutable content-hashed assets: a cache hit needs no revalidation. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => cached ?? Response.error())
  return cached ?? network
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Only ever handle our own GET requests. Cross-origin (fonts, etc.) and
  // any /api/* call pass straight through to the network untouched.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request))
    return
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(event.request))
    return
  }

  event.respondWith(staleWhileRevalidate(event.request))
})
