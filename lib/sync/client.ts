import type { VectorClock } from '@/lib/events/envelope'
import type { AnyEvent } from '@/lib/events/schemas'
import { increment } from '@/lib/domain/vector-clock'
import type { SyncRequestT, SyncResponseT } from './protocol'

/**
 * Transport- and storage-agnostic client sync engine. Everything it needs
 * is injected as a "port" so the exact same engine code runs against the
 * Dexie/IndexedDB store + fetch() in the browser (UI phase) and against
 * an in-memory store + a direct call into lib/sync/server.ts in tests
 * (test/unit/client-sync.test.ts) — the point being that a divergence
 * test exercises the REAL client code path, not a hand-rolled stub of it.
 */
export interface OutboxPort {
  /** Events minted locally but not yet confirmed accepted by the server,
   * in the order they were minted. */
  getPending(): Promise<AnyEvent[]>
  /** Called once the server has confirmed these ids — removes them from
   * the pending queue. */
  markAccepted(ids: string[]): Promise<void>
  /** Events the server has sent us for entities we don't own locally yet
   * or need to merge — the caller's reducer/projection layer applies
   * these; the engine itself only plumbs them through. */
  applyRemote(events: AnyEvent[]): Promise<void>
}

export interface CursorPort {
  getSinceSeq(): Promise<number>
  setSinceSeq(seq: number): Promise<void>
  getClock(): Promise<VectorClock>
  setClock(clock: VectorClock): Promise<void>
}

export interface TransportPort {
  push(request: SyncRequestT): Promise<SyncResponseT>
}

export interface SyncEngineDeps {
  deviceId: string
  outbox: OutboxPort
  cursor: CursorPort
  transport: TransportPort
}

export interface SyncResult {
  accepted: number
  pulled: number
  hasMore: boolean
}

/**
 * One sync cycle: drain the local outbox to the server, apply whatever
 * the server sends back. Retry-safety comes from the server side
 * (lib/sync/server.ts dedupes by event id) — this engine can call
 * `runSyncCycle` again after any failure with no special-casing.
 */
export async function runSyncCycle(deps: SyncEngineDeps): Promise<SyncResult> {
  const { outbox, cursor, transport, deviceId } = deps

  const pending = await outbox.getPending()
  const sinceSeq = await cursor.getSinceSeq()
  const clock = await cursor.getClock()

  const response = await transport.push({
    device_id: deviceId,
    since_seq: sinceSeq,
    client_clock: clock,
    events: pending,
    include_own: false,
  })

  if (response.rejected.length > 0) {
    // Whole-batch atomic rejection (docs/DECISIONS.md): the caller is
    // expected to quarantine the named ids and retry without them. This
    // engine doesn't guess at recovery — it surfaces the rejection as-is.
    throw new SyncRejectedError(response.rejected)
  }

  const acceptedIds = response.accepted.map((a) => a.id)
  if (acceptedIds.length > 0) await outbox.markAccepted(acceptedIds)
  if (response.events.length > 0) await outbox.applyRemote(response.events)

  await cursor.setSinceSeq(response.next_seq)
  await cursor.setClock(response.server_clock)

  return { accepted: acceptedIds.length, pulled: response.events.length, hasMore: response.has_more }
}

export class SyncRejectedError extends Error {
  constructor(public rejected: { id: string; reason: string }[]) {
    super(`sync batch rejected: ${rejected.map((r) => `${r.id} (${r.reason})`).join(', ')}`)
    this.name = 'SyncRejectedError'
  }
}

/** Bumps this device's own vector clock component before minting a new
 * local event — the one piece of "clock bookkeeping" every caller needs
 * and that belongs beside the engine rather than duplicated per adapter. */
export function nextDeviceClock(current: VectorClock, deviceId: string): VectorClock {
  return increment(current, deviceId)
}
