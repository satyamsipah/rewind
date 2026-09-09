import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { projections, users } from '@/lib/db/schema'
import { redo, undo } from '@/lib/db/undo'
import { syncPush } from '@/lib/sync/server'
import { createTestDb, type TestDb } from './db'

const USER = '00000000-0000-4000-8000-000000000001'
const DEVICE = '00000000-0000-4000-8000-00000000000a'
const TASK = '00000000-0000-4000-8000-000000000010'
const LIST = '00000000-0000-4000-8000-0000000000ff'

async function taskState(db: TestDb) {
  const [row] = await db
    .select()
    .from(projections)
    .where(and(eq(projections.userId, USER), eq(projections.entityId, TASK)))
  return row?.state as { title: string } | undefined
}

describe('undo/redo (lib/db/undo.ts)', () => {
  let db: TestDb
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const { db: testDb, client } = await createTestDb()
    db = testDb
    cleanup = () => client.close()
    await db.insert(users).values({ id: USER, email: 'a@example.com' })
    await syncPush(db, USER, {
      device_id: DEVICE,
      since_seq: 0,
      client_clock: {},
      events: [
        {
          id: '00000000-0000-7000-8000-000000000001',
          schema_version: 1,
          actor_id: USER,
          device_id: DEVICE,
          entity_id: TASK,
          entity_type: 'task',
          client_timestamp: '2026-01-01T00:00:00.000Z',
          server_timestamp: null,
          vector_clock: { [DEVICE]: 1 },
          type: 'TaskCreated',
          payload: { list_id: LIST, title: 'Alpha', position: 'a0' },
        },
      ],
      include_own: false,
    })
    await syncPush(db, USER, {
      device_id: DEVICE,
      since_seq: 0,
      client_clock: {},
      events: [
        {
          id: '00000000-0000-7000-8000-000000000002',
          schema_version: 1,
          actor_id: USER,
          device_id: DEVICE,
          entity_id: TASK,
          entity_type: 'task',
          client_timestamp: '2026-01-01T01:00:00.000Z',
          server_timestamp: null,
          vector_clock: { [DEVICE]: 2 },
          type: 'TaskRenamed',
          payload: { from: 'Alpha', to: 'Beta' },
        },
      ],
      include_own: false,
    })
  })

  afterEach(() => cleanup())

  it('undo reverts the most recent action; redo re-applies it', async () => {
    expect((await taskState(db))?.title).toBe('Beta')

    const undone = await undo(db, USER, DEVICE)
    expect(undone).not.toBeNull()
    expect((await taskState(db))?.title).toBe('Alpha')

    const redone = await redo(db, USER, DEVICE)
    expect(redone).not.toBeNull()
    expect((await taskState(db))?.title).toBe('Beta')
  })

  it('a new action after an undo clears the redo stack', async () => {
    await undo(db, USER, DEVICE) // title back to 'Alpha'

    await syncPush(db, USER, {
      device_id: DEVICE,
      since_seq: 0,
      client_clock: {},
      events: [
        {
          id: '00000000-0000-7000-8000-000000000003',
          schema_version: 1,
          actor_id: USER,
          device_id: DEVICE,
          entity_id: TASK,
          entity_type: 'task',
          client_timestamp: '2026-01-01T02:00:00.000Z',
          server_timestamp: null,
          vector_clock: { [DEVICE]: 3 },
          type: 'TaskRenamed',
          payload: { from: 'Alpha', to: 'Gamma' },
        },
      ],
      include_own: false,
    })

    const redone = await redo(db, USER, DEVICE)
    expect(redone).toBeNull()
    expect((await taskState(db))?.title).toBe('Gamma')
  })

  it('undoing with nothing left on the stack is a no-op', async () => {
    await undo(db, USER, DEVICE)
    await undo(db, USER, DEVICE)
    const third = await undo(db, USER, DEVICE)
    expect(third).toBeNull()
  })
})
