import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { canonical } from '@/lib/domain/canonical'
import { reduce } from '@/lib/domain/reducer'
import { rowToEvent } from '@/lib/db/mappers'
import { events, users } from '@/lib/db/schema'
import { getStateAt } from '@/lib/db/snapshots'
import { syncPush } from '@/lib/sync/server'
import { createTestDb, type TestDb } from './db'

const USER = '00000000-0000-4000-8000-000000000001'
const DEVICE = '00000000-0000-4000-8000-00000000000a'
const TASK = '00000000-0000-4000-8000-000000000010'
const LIST = '00000000-0000-4000-8000-0000000000ff'

function evt(id: string, type: string, payload: unknown, clientTs: string, clock: number) {
  return {
    id,
    schema_version: 1,
    actor_id: USER,
    device_id: DEVICE,
    entity_id: TASK,
    entity_type: 'task',
    client_timestamp: clientTs,
    server_timestamp: null,
    vector_clock: { [DEVICE]: clock },
    type,
    payload,
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Time travel is deliberately keyed on `server_timestamp` (the instant
 * the server accepted an event — assigned by the DB, not the client), not
 * `client_timestamp` — docs/DECISIONS.md "Time travel is over
 * server_timestamp". So this test captures the REAL server_timestamp each
 * push is given back and queries around those, rather than assuming it
 * lines up with the (fictional, 2026-dated) client_timestamp values.
 */
describe('time travel: GET /snapshot?at=<timestamp>', () => {
  let db: TestDb
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const { db: testDb, client } = await createTestDb()
    db = testDb
    cleanup = () => client.close()
    await db.insert(users).values({ id: USER, email: 'a@example.com' })
  })

  afterEach(() => cleanup())

  it('queries at three past instants return exactly the expected state at each', async () => {
    const r1 = await syncPush(db, USER, {
      device_id: DEVICE,
      since_seq: 0,
      client_clock: {},
      events: [evt('00000000-0000-7000-8000-000000000001', 'TaskCreated', { list_id: LIST, title: 'Alpha', position: 'a0' }, '2026-01-01T00:00:00.000Z', 1)],
      include_own: false,
    })
    const t1 = new Date(new Date(r1.accepted[0]!.server_timestamp).getTime() + 1)
    await sleep(10)

    const r2 = await syncPush(db, USER, {
      device_id: DEVICE,
      since_seq: 0,
      client_clock: {},
      events: [evt('00000000-0000-7000-8000-000000000002', 'TaskDueDateSet', { from: null, to: '2026-03-01T00:00:00.000Z' }, '2026-01-02T00:00:00.000Z', 2)],
      include_own: false,
    })
    const t2 = new Date(new Date(r2.accepted[0]!.server_timestamp).getTime() + 1)
    await sleep(10)

    const r3 = await syncPush(db, USER, {
      device_id: DEVICE,
      since_seq: 0,
      client_clock: {},
      events: [evt('00000000-0000-7000-8000-000000000003', 'TaskCompleted', { completed_at: '2026-01-03T00:00:00.000Z' }, '2026-01-03T00:00:00.000Z', 3)],
      include_own: false,
    })
    const t3 = new Date(new Date(r3.accepted[0]!.server_timestamp).getTime() + 1)

    const stateAtT1 = await getStateAt(db, USER, t1)
    expect(stateAtT1.tasks[TASK]).toMatchObject({ title: 'Alpha', due_date: null, completed: false })

    const stateAtT2 = await getStateAt(db, USER, t2)
    expect(stateAtT2.tasks[TASK]).toMatchObject({ title: 'Alpha', due_date: '2026-03-01T00:00:00.000Z', completed: false })

    const stateAtT3 = await getStateAt(db, USER, t3)
    expect(stateAtT3.tasks[TASK]).toMatchObject({ title: 'Alpha', due_date: '2026-03-01T00:00:00.000Z', completed: true })

    // Querying strictly before creation returns no task at all.
    const before = await getStateAt(db, USER, new Date(new Date(r1.accepted[0]!.server_timestamp).getTime() - 1))
    expect(before.tasks[TASK]).toBeUndefined()

    // "Now" (no `at`) matches a full replay of everything.
    const rows = await db.select().from(events).where(eq(events.userId, USER))
    const fullReplay = reduce(rows.map(rowToEvent))
    const now = await getStateAt(db, USER)
    expect(canonical(now)).toBe(canonical(fullReplay))
  })
})
