import type { VectorClock } from '@/lib/events/envelope'
import type { AnyEvent } from '@/lib/events/schemas'
import type { CursorPort, OutboxPort, TransportPort } from '@/lib/sync/client'
import { SyncRequest, type SyncResponseT } from '@/lib/sync/protocol'
import { db } from './db'
import { getOrCreateDeviceId } from './identity'
import { rebuildLocalProjection } from './projection'

/**
 * Dexie-backed implementation of the ports lib/sync/client.ts's
 * `runSyncCycle` depends on — the same engine that already runs against
 * `InMemoryClientStore` in tests now runs against the real browser store.
 */
export class DexieOutboxPort implements OutboxPort {
  async getPending(): Promise<AnyEvent[]> {
    const rows = await db.outbox.orderBy('createdAt').toArray()
    const ids = rows.map((r) => r.id)
    const events = await db.events.bulkGet(ids)
    return events.filter((e): e is AnyEvent => e !== undefined)
  }

  async markAccepted(ids: string[]): Promise<void> {
    await db.outbox.bulkDelete(ids)
  }

  async applyRemote(events: AnyEvent[]): Promise<void> {
    const touched = new Map<string, AnyEvent['entity_type']>()
    await db.transaction('rw', db.events, async () => {
      for (const event of events) {
        const exists = await db.events.get(event.id)
        if (exists) continue // already applied (e.g. our own event echoed back)
        await db.events.put(event)
        touched.set(event.entity_id, event.entity_type)
      }
    })
    for (const [entityId, entityType] of touched) {
      await rebuildLocalProjection(entityId, entityType)
    }
  }
}

export class DexieCursorPort implements CursorPort {
  async getSinceSeq(): Promise<number> {
    return (await db.syncMeta.get('singleton'))?.sinceSeq ?? 0
  }
  async setSinceSeq(seq: number): Promise<void> {
    await db.syncMeta.update('singleton', { sinceSeq: seq })
  }
  async getClock(): Promise<VectorClock> {
    return (await db.syncMeta.get('singleton'))?.clock ?? {}
  }
  async setClock(clock: VectorClock): Promise<void> {
    await db.syncMeta.update('singleton', { clock })
  }
}

/** Non-retryable: the server told us the batch is structurally invalid or
 * we're not who we claim to be — backing off and resending verbatim will
 * never succeed (lib/sync/client.ts's SyncRejectedError already covers
 * the 422 case; this covers everything else worth distinguishing from a
 * transient network blip). */
export class SyncHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SyncHttpError'
  }
}

export const fetchTransport: TransportPort = {
  async push(request) {
    const body = SyncRequest.parse(request)
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 401 || res.status === 403) {
      throw new SyncHttpError(res.status, 'session expired or unauthorized')
    }
    if (!res.ok && res.status !== 422) {
      throw new SyncHttpError(res.status, `sync request failed with status ${res.status}`)
    }
    return (await res.json()) as SyncResponseT
  },
}

export function currentDeviceId(): string {
  return getOrCreateDeviceId()
}
