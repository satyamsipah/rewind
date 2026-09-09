import { runSyncCycle } from '@/lib/sync/client'
import { SyncRejectedError } from '@/lib/sync/client'
import { DexieCursorPort, DexieOutboxPort, SyncHttpError, currentDeviceId, fetchTransport } from './sync-adapter'
import { db } from './db'

/**
 * Background sync engine — trigger strategy, exponential backoff with
 * full jitter, and the visible status state machine (docs/DECISIONS.md
 * "Client sync architecture"). A singleton module, not a class instance,
 * because there is exactly one sync loop per browser tab and every
 * caller (mutations, providers, the status indicator) wants the same one.
 */
export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'error' | 'signed_out'

export interface SyncEvent {
  status: SyncStatus
  lastError?: string
  /** A pulled remote change touched an entity with a pending local
   * change — a real concurrent merge just happened. Informational only;
   * principle 5 means it never blocks anything (docs/DECISIONS.md). */
  merged?: { count: number }
}

const outbox = new DexieOutboxPort()
const cursor = new DexieCursorPort()

let status: SyncStatus = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'synced'
const listeners = new Set<(event: SyncEvent) => void>()

function emit(event: SyncEvent): void {
  status = event.status
  for (const listener of listeners) listener(event)
}

export function subscribeSyncStatus(listener: (event: SyncEvent) => void): () => void {
  listeners.add(listener)
  listener({ status })
  return () => listeners.delete(listener)
}

export function getSyncStatus(): SyncStatus {
  return status
}

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30000
const FALLBACK_INTERVAL_MS = 30000
const DEBOUNCE_MS = 300

let attempt = 0
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let backoffTimer: ReturnType<typeof setTimeout> | undefined
let inFlight: Promise<void> | undefined
let started = false

/** Full jitter (AWS's recommended backoff shape): spreads retries evenly
 * across [0, cap] rather than clustering near a fixed floor, which is
 * what keeps many clients recovering from an outage together from
 * retrying in lockstep. */
function backoffDelay(n: number): number {
  const cap = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** n)
  return Math.random() * cap
}

async function runOnce(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    emit({ status: 'offline' })
    return
  }

  emit({ status: 'syncing' })
  try {
    const pendingBefore = await outbox.getPending()
    const touchedByUs = new Set(pendingBefore.map((e) => e.entity_id))

    const result = await runSyncCycle({ deviceId: currentDeviceId(), outbox, cursor, transport: fetchTransport })
    attempt = 0

    const merged = result.pulled > 0 && touchedByUs.size > 0
    emit({ status: 'synced', merged: merged ? { count: result.pulled } : undefined })

    if (result.hasMore) scheduleImmediate()
  } catch (err) {
    if (err instanceof SyncHttpError && (err.status === 401 || err.status === 403)) {
      // Not retryable by backing off — the session itself is gone.
      emit({ status: 'signed_out', lastError: err.message })
      return
    }
    if (err instanceof SyncRejectedError) {
      // The bad ids are already excluded from future batches by the
      // caller quarantining them (docs/DECISIONS.md) — nothing else in
      // the batch is blocked, so just surface it and keep the loop alive
      // at normal cadence rather than backing off.
      emit({ status: 'error', lastError: err.message })
      return
    }
    attempt += 1
    emit({ status: 'error', lastError: err instanceof Error ? err.message : String(err) })
    scheduleBackoff()
  }
}

function scheduleImmediate(): void {
  if (inFlight) return
  inFlight = runOnce().finally(() => {
    inFlight = undefined
  })
}

function scheduleBackoff(): void {
  if (backoffTimer) clearTimeout(backoffTimer)
  backoffTimer = setTimeout(scheduleImmediate, backoffDelay(attempt))
}

/** Called by lib/client/mutations.ts after every local write — debounced
 * so a burst of edits (typing a title) doesn't fire a request per
 * keystroke. */
export function notifyLocalMutation(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(scheduleImmediate, DEBOUNCE_MS)
}

/** Manual trigger — used by the status indicator's "retry now" action and
 * on startup to resume a queue left over from a killed session (see
 * docs/DECISIONS.md: idempotent dedupe-by-id makes this always safe). */
export function triggerSync(): void {
  scheduleImmediate()
}

let sseSource: EventSource | undefined

function connectStream(): void {
  if (typeof EventSource === 'undefined' || sseSource) return
  cursor.getSinceSeq().then((since) => {
    sseSource = new EventSource(`/api/sync/stream?since=${since}`)
    sseSource.addEventListener('nudge', () => scheduleImmediate())
    sseSource.onerror = () => {
      sseSource?.close()
      sseSource = undefined
      // The browser's own EventSource retry (or the next online/visible/
      // fallback trigger) reconnects; nothing to do here.
    }
  })
}

/** Wires up every trigger (docs/DECISIONS.md "Trigger strategy") and
 * resumes any queue left over from a previous session. Call once, e.g.
 * from a top-level provider (components/providers/sync-provider.tsx). */
export function startSyncEngine(): () => void {
  if (started) return () => {}
  started = true

  const onOnline = () => {
    emit({ status: 'syncing' })
    scheduleImmediate()
    connectStream()
  }
  const onOffline = () => {
    sseSource?.close()
    sseSource = undefined
    emit({ status: 'offline' })
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') scheduleImmediate()
  }

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  const fallback = setInterval(scheduleImmediate, FALLBACK_INTERVAL_MS)

  // Resume-on-startup: if the outbox is non-empty (the app was closed
  // mid-sync last time), this immediately retries it. No special "was a
  // request in flight" journal needed — see docs/DECISIONS.md.
  if (navigator.onLine) {
    scheduleImmediate()
    connectStream()
  } else {
    emit({ status: 'offline' })
  }

  return () => {
    started = false
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
    clearInterval(fallback)
    if (debounceTimer) clearTimeout(debounceTimer)
    if (backoffTimer) clearTimeout(backoffTimer)
    sseSource?.close()
    sseSource = undefined
  }
}

/** Exposed for tests that want to assert on outbox size without going
 * through the full engine. */
export async function pendingCount(): Promise<number> {
  return db.outbox.count()
}
