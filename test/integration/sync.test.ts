import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { events, users } from '@/lib/db/schema'
import { syncPush } from '@/lib/sync/server'
import { createTestDb, type TestDb } from './db'

const USER = '00000000-0000-4000-8000-000000000001'
const OTHER_USER = '00000000-0000-4000-8000-000000000002'
const DEVICE_A = '00000000-0000-4000-8000-00000000000a'
const DEVICE_B = '00000000-0000-4000-8000-00000000000b'
const LIST_ID = '00000000-0000-4000-8000-0000000000ff'

function taskCreated(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '00000000-0000-7000-8000-000000000001',
    schema_version: 1,
    actor_id: USER,
    device_id: DEVICE_A,
    entity_id: '00000000-0000-4000-8000-000000000010',
    entity_type: 'task',
    client_timestamp: '2026-01-01T00:00:00.000Z',
    server_timestamp: null,
    vector_clock: { [DEVICE_A]: 1 },
    type: 'TaskCreated',
    payload: { list_id: LIST_ID, title: 'Alpha', position: 'a0' },
    ...overrides,
  }
}

describe('POST /sync server core (lib/sync/server.ts)', () => {
  let db: TestDb
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const { db: testDb, client } = await createTestDb()
    db = testDb
    cleanup = () => client.close()
    await db.insert(users).values([
      { id: USER, email: 'a@example.com' },
      { id: OTHER_USER, email: 'b@example.com' },
    ])
  })

  afterEach(() => cleanup())

  it('accepts a new event and assigns it user_seq starting at 1', async () => {
    const res = await syncPush(db, USER, {
      device_id: DEVICE_A,
      since_seq: 0,
      client_clock: { [DEVICE_A]: 1 },
      events: [taskCreated()],
      include_own: false,
    })
    expect(res.accepted).toHaveLength(1)
    expect(res.accepted[0]!.user_seq).toBe(1)
    expect(res.duplicates).toEqual([])
    expect(res.rejected).toEqual([])
  })

  it('idempotency: replaying the same batch twice is a no-op the second time', async () => {
    const batch = { device_id: DEVICE_A, since_seq: 0, client_clock: { [DEVICE_A]: 1 }, events: [taskCreated()], include_own: false }

    const first = await syncPush(db, USER, batch)
    expect(first.accepted).toHaveLength(1)

    const second = await syncPush(db, USER, batch)
    expect(second.accepted).toEqual([])
    expect(second.duplicates).toEqual([taskCreated().id])

    const rows = await db.select().from(events).where(eq(events.userId, USER))
    expect(rows).toHaveLength(1)
  })

  it('a device does not receive its own events back on pull unless include_own is set', async () => {
    await syncPush(db, USER, {
      device_id: DEVICE_A,
      since_seq: 0,
      client_clock: { [DEVICE_A]: 1 },
      events: [taskCreated()],
      include_own: false,
    })

    const pullSelf = await syncPush(db, USER, {
      device_id: DEVICE_A,
      since_seq: 0,
      client_clock: { [DEVICE_A]: 1 },
      events: [],
      include_own: false,
    })
    expect(pullSelf.events).toEqual([])

    const pullOther = await syncPush(db, USER, {
      device_id: DEVICE_B,
      since_seq: 0,
      client_clock: {},
      events: [],
      include_own: false,
    })
    expect(pullOther.events).toHaveLength(1)
    expect(pullOther.events[0]!.type).toBe('TaskCreated')
  })

  it('rejects the whole batch atomically when one event fails validation', async () => {
    const good = taskCreated()
    const bad = { ...taskCreated({ id: '00000000-0000-7000-8000-000000000002' }), payload: { bogus: true } }

    const res = await syncPush(db, USER, {
      device_id: DEVICE_A,
      since_seq: 0,
      client_clock: {},
      events: [good, bad],
      include_own: false,
    })

    expect(res.accepted).toEqual([])
    expect(res.rejected).toHaveLength(1)
    expect(res.rejected[0]!.reason).toBe('schema_invalid')

    const rows = await db.select().from(events).where(eq(events.userId, USER))
    expect(rows).toHaveLength(0)
  })

  it('rejects an event whose actor_id does not match the authenticated user', async () => {
    const spoofed = taskCreated({ actor_id: OTHER_USER })
    const res = await syncPush(db, USER, {
      device_id: DEVICE_A,
      since_seq: 0,
      client_clock: {},
      events: [spoofed],
      include_own: false,
    })
    expect(res.rejected).toEqual([{ id: spoofed.id, reason: 'actor_mismatch' }])
  })

  it('auth isolation: one user cannot see another user events via pull', async () => {
    await syncPush(db, USER, {
      device_id: DEVICE_A,
      since_seq: 0,
      client_clock: {},
      events: [taskCreated()],
      include_own: false,
    })

    const otherPull = await syncPush(db, OTHER_USER, {
      device_id: '00000000-0000-4000-8000-00000000000c',
      since_seq: 0,
      client_clock: {},
      events: [],
      include_own: false,
    })
    expect(otherPull.events).toEqual([])
  })
})
