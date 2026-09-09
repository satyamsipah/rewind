import { describe, expect, it } from 'vitest'
import { buildEvent } from '@/lib/test-support/build-event'
import { DEVICE_A, fakeId } from '@/lib/test-support/ids'
import { runSyncCycle, type TransportPort } from '@/lib/sync/client'
import { InMemoryClientStore } from '@/lib/sync/in-memory-adapter'
import type { SyncResponseT } from '@/lib/sync/protocol'

/**
 * Regression test for the "app closed mid-sync" fix: a batch the server
 * already committed, but whose acceptance response never reached the
 * client, comes back on retry entirely as `duplicates` (never
 * `accepted`) — the outbox must still clear those, or they'd be resent
 * forever (docs/DECISIONS.md "Client sync architecture").
 */
describe('runSyncCycle: duplicates count as confirmed, not just accepted', () => {
  it('clears the outbox for ids returned only in `duplicates`', async () => {
    const taskId = fakeId()
    const listId = fakeId()
    const event = buildEvent({
      type: 'TaskCreated',
      entity_id: taskId,
      entity_type: 'task',
      payload: { list_id: listId, title: 'Alpha', position: 'a0' },
    })

    const store = new InMemoryClientStore()
    store.enqueue(event)

    const response: SyncResponseT = {
      accepted: [],
      duplicates: [event.id],
      rejected: [],
      events: [],
      server_clock: {},
      next_seq: 1,
      has_more: false,
    }
    const transport: TransportPort = { push: async () => response }

    await runSyncCycle({ deviceId: DEVICE_A, outbox: store, cursor: store, transport })

    expect(await store.getPending()).toEqual([])
  })
})
