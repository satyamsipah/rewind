'use client'

import { useEffect } from 'react'

/** Registers public/sw.js once, on mount. Silently no-ops in any
 * environment without service worker support (e.g. Safari in some
 * private-browsing modes) rather than throwing — the app is fully
 * functional without it, just not installable/offline-from-cold-start. */
export function useRegisterServiceWorker(): void {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Best-effort — see comment above.
    })
  }, [])
}
