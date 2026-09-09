import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonical } from '@/lib/domain/canonical'
import { createEvent } from '@/lib/events/factory'
import { increment } from '@/lib/domain/vector-clock'
import { runSyncCycle, type TransportPort } from '@/lib/sync/client'
import { InMemoryClientStore } from '@/lib/sync/in-memory-adapter'
import { users } from '@/lib/db/schema'
import { syncPush } from '@/lib/sync/server'
import { createTestDb, type TestDb } from './db'

const USER = '00000000-0000-4000-8000-000000000001'
const DEVICE_A = '00000000-0000-4000-8000-00000000000a'
const DEVICE_B = '00000000-0000-4000-8000-00000000000b'
const LIST = '00000000-0000-4000-8000-0000000000ff'

/**
 * lib/sync/client.ts's runSyncCycle, driven by two independent
 * InMemoryClientStore instances (lib/sync/in-memory-adapter.ts) against a
 * shared real (PGlite) server — the divergence scenario exercised through
 * the ACTUAL client engine code, not a hand-rolled stand-in for it
 * (docs/DECISIONS.md "Client sync engine").
 */
describe('client sync engine: two devices diverge offline, then both sync', () => {
  let db: TestDb
  let cleanup: () => Promise<void>
  let transport: TransportPort

  beforeEach(async () => {
    const { db: testDb, client } = await createTestDb()
    db = testDb
    cleanup = () => client.close()
    await db.insert(users).values({ id: USER, email: 'a@example.com' })
    transport = { push: (request) => syncPush(db, USER, request) }
  })

  afterEach(() => cleanup())

  it('both clients converge to the same task state', async () => {
    const clientA = new InMemoryClientStore()
    const clientB = new InMemoryClientStore()

    // Device A creates the task and pushes it.
    let clockA = increment({}, DEVICE_A)
    const taskId = '00000000-0000-4000-8000-000000000010'
    clientA.enqueue(
      createEvent({
        type: 'TaskCreated',
        actor_id: USER,
        device_id: DEVICE_A,
        entity_id: taskId,
        entity_type: 'task',
        payload: { list_id: LIST, title: 'Alpha', position: 'a0' },
        vector_clock: clockA,
      }),
    )
    await runSyncCycle({ deviceId: DEVICE_A, outbox: clientA, cursor: clientA, transport })

    // Device B catches up to the common ancestor before going "offline".
    await runSyncCycle({ deviceId: DEVICE_B, outbox: clientB, cursor: clientB, transport })
    expect(clientB.state().tasks[taskId]?.title).toBe('Alpha')

    // Both devices now edit offline, concurrently, without syncing yet.
    clockA = increment(await clientA.getClock(), DEVICE_A)
    clientA.enqueue(
      createEvent({
        type: 'TagAdded',
        actor_id: USER,
        device_id: DEVICE_A,
        entity_id: taskId,
        entity_type: 'task',
        payload: { tag: 'urgent' },
        vector_clock: clockA,
      }),
    )

    const clockB = increment(await clientB.getClock(), DEVICE_B)
    clientB.enqueue(
      createEvent({
        type: 'TagAdded',
        actor_id: USER,
        device_id: DEVICE_B,
        entity_id: taskId,
        entity_type: 'task',
        payload: { tag: 'blocked' },
        vector_clock: clockB,
      }),
    )

    // A syncs first, then B, then A again to pick up B's change.
    await runSyncCycle({ deviceId: DEVICE_A, outbox: clientA, cursor: clientA, transport })
    await runSyncCycle({ deviceId: DEVICE_B, outbox: clientB, cursor: clientB, transport })
    await runSyncCycle({ deviceId: DEVICE_A, outbox: clientA, cursor: clientA, transport })

    const stateA = clientA.state()
    const stateB = clientB.state()
    expect(canonical(stateA)).toBe(canonical(stateB))
    expect(stateA.tasks[taskId]?.tags.sort()).toEqual(['blocked', 'urgent'])
  })
})
