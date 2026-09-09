import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { canonical } from '@/lib/domain/canonical'
import { reduce } from '@/lib/domain/reducer'
import { rowToEvent } from '@/lib/db/mappers'
import { events, users } from '@/lib/db/schema'
import { createSnapshot, getStateAt, SNAPSHOT_CADENCE } from '@/lib/db/snapshots'
import { syncPush } from '@/lib/sync/server'
import { createTestDb, type TestDb } from './db'

const USER = '00000000-0000-4000-8000-000000000001'
const DEVICE = '00000000-0000-4000-8000-00000000000a'
const LIST = '00000000-0000-4000-8000-0000000000ff'

function taskCreated(n: number) {
  const taskId = `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
  return {
    id: `00000000-0000-7000-8000-${(n * 2).toString(16).padStart(12, '0')}`,
    schema_version: 1,
    actor_id: USER,
    device_id: DEVICE,
    entity_id: taskId,
    entity_type: 'task',
    client_timestamp: '2026-01-01T00:00:00.000Z',
    server_timestamp: null,
    vector_clock: { [DEVICE]: n * 2 },
    type: 'TaskCreated',
    payload: { list_id: LIST, title: `Task ${n}`, position: `a${n}` },
  }
}

function taskRenamed(n: number, from: string, to: string) {
  const taskId = `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
  return {
    id: `00000000-0000-7000-8000-${(n * 2 + 1).toString(16).padStart(12, '0')}`,
    schema_version: 1,
    actor_id: USER,
    device_id: DEVICE,
    entity_id: taskId,
    entity_type: 'task',
    client_timestamp: '2026-01-01T01:00:00.000Z',
    server_timestamp: null,
    vector_clock: { [DEVICE]: n * 2 + 1 },
    type: 'TaskRenamed',
    payload: { from, to },
  }
}

describe('snapshot correctness: snapshot + delta equals full replay, byte for byte', () => {
  let db: TestDb
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const { db: testDb, client } = await createTestDb()
    db = testDb
    cleanup = () => client.close()
    await db.insert(users).values({ id: USER, email: 'a@example.com' })
  })

  afterEach(() => cleanup())

  it('resuming from a snapshot matches a full replay exactly', async () => {
    // More than SNAPSHOT_CADENCE tasks, each created then renamed, so a
    // snapshot is guaranteed to have been taken partway through by the
    // time all events land (lib/sync/server.ts calls maybeCreateSnapshot
    // after every accepted batch).
    const taskCount = SNAPSHOT_CADENCE / 2 + 20 // creates + renames > cadence
    for (let n = 1; n <= taskCount; n++) {
      await syncPush(db, USER, {
        device_id: DEVICE,
        since_seq: 0,
        client_clock: {},
        events: [taskCreated(n)],
        include_own: false,
      })
      await syncPush(db, USER, {
        device_id: DEVICE,
        since_seq: 0,
        client_clock: {},
        events: [taskRenamed(n, `Task ${n}`, `Task ${n} renamed`)],
        include_own: false,
      })
    }

    // Force one more snapshot right up to the current high-water mark, so
    // getStateAt's resume path is definitely exercised (not just the
    // delta-only path for a user with no snapshot yet).
    await createSnapshot(db, USER)

    const rows = await db.select().from(events).where(eq(events.userId, USER))
    expect(rows.length).toBeGreaterThan(SNAPSHOT_CADENCE)

    const fullReplay = reduce(rows.map(rowToEvent))
    const resumed = await getStateAt(db, USER)

    expect(canonical(resumed)).toBe(canonical(fullReplay))
    expect(Object.keys(resumed.tasks)).toHaveLength(taskCount)
  })
})
