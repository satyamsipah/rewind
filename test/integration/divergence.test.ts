import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { projections, users } from '@/lib/db/schema'
import { syncPush } from '@/lib/sync/server'
import { createTestDb, type TestDb } from './db'

const USER = '00000000-0000-4000-8000-000000000001'
const DEVICE_A = '00000000-0000-4000-8000-00000000000a'
const DEVICE_B = '00000000-0000-4000-8000-00000000000b'
const TASK = '00000000-0000-4000-8000-000000000010'
const LIST = '00000000-0000-4000-8000-0000000000ff'

/**
 * .claude/rules/testing.md: "Sync tests simulate two clients diverging
 * offline and reconciling." Domain-level correctness of the merge rule
 * itself is exhaustively covered in lib/domain/divergence.test.ts; this
 * exercises the SAME scenario through the real POST /sync path (dedupe,
 * user_seq allocation, projection rebuild) to prove the two layers agree.
 */
describe('sync divergence: two devices edit offline, then both sync', () => {
  let db: TestDb
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const { db: testDb, client } = await createTestDb()
    db = testDb
    cleanup = () => client.close()
    await db.insert(users).values({ id: USER, email: 'a@example.com' })

    // Common ancestor both devices have already synced: the task exists,
    // clock { A: 1 } known to both.
    await syncPush(db, USER, {
      device_id: DEVICE_A,
      since_seq: 0,
      client_clock: { [DEVICE_A]: 1 },
      events: [
        {
          id: '00000000-0000-7000-8000-000000000001',
          schema_version: 1,
          actor_id: USER,
          device_id: DEVICE_A,
          entity_id: TASK,
          entity_type: 'task',
          client_timestamp: '2026-01-01T00:00:00.000Z',
          server_timestamp: null,
          vector_clock: { [DEVICE_A]: 1 },
          type: 'TaskCreated',
          payload: { list_id: LIST, title: 'Alpha', position: 'a0' },
        },
      ],
      include_own: false,
    })
  })

  afterEach(() => cleanup())

  it('both devices converge on the same projection regardless of sync order', async () => {
    // Device A, offline: adds tag "urgent".
    const addUrgent = {
      id: '00000000-0000-7000-8000-000000000002',
      schema_version: 1,
      actor_id: USER,
      device_id: DEVICE_A,
      entity_id: TASK,
      entity_type: 'task',
      client_timestamp: '2026-01-01T01:00:00.000Z',
      server_timestamp: null,
      vector_clock: { [DEVICE_A]: 2 },
      type: 'TagAdded',
      payload: { tag: 'urgent' },
    }

    // Device B, offline (never saw A's tag add): adds tag "blocked".
    const addBlocked = {
      id: '00000000-0000-7000-8000-000000000003',
      schema_version: 1,
      actor_id: USER,
      device_id: DEVICE_B,
      entity_id: TASK,
      entity_type: 'task',
      client_timestamp: '2026-01-01T01:30:00.000Z',
      server_timestamp: null,
      vector_clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 },
      type: 'TagAdded',
      payload: { tag: 'blocked' },
    }

    // A syncs first, then B.
    await syncPush(db, USER, { device_id: DEVICE_A, since_seq: 0, client_clock: { [DEVICE_A]: 2 }, events: [addUrgent], include_own: false })
    const bResult = await syncPush(db, USER, { device_id: DEVICE_B, since_seq: 0, client_clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 }, events: [addBlocked], include_own: false })

    // B's pull picks up A's offline tag add.
    expect(bResult.events.some((e) => e.id === addUrgent.id)).toBe(true)

    // A pulls again to learn about B's tag add too.
    const aResult = await syncPush(db, USER, { device_id: DEVICE_A, since_seq: 2, client_clock: { [DEVICE_A]: 2 }, events: [], include_own: false })
    expect(aResult.events.some((e) => e.id === addBlocked.id)).toBe(true)

    // Both tags survive in the server-side projection (rebuilt after each push).
    const [row] = await db
      .select()
      .from(projections)
      .where(and(eq(projections.userId, USER), eq(projections.entityId, TASK)))
    expect((row?.state as { tags: string[] }).tags.sort()).toEqual(['blocked', 'urgent'])
  })
})
