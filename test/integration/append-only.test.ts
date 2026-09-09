import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { events, users } from '@/lib/db/schema'
import { createTestDb, type TestDb } from './db'

/**
 * CLAUDE.md principle 1, enforced at the database level
 * (drizzle/0001_append_only_and_indexes.sql). This is the one property
 * that MUST be tested against a real Postgres engine, not a JS mock — a
 * mock would just assert "we didn't call UPDATE", not "the database
 * itself refuses one".
 */
describe('events table is append-only', () => {
  let db: TestDb
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const { db: testDb, client } = await createTestDb()
    db = testDb
    cleanup = () => client.close()

    await db.insert(users).values({ id: 'user-1', email: 'a@example.com' })
    await db.insert(events).values({
      id: 'evt-1',
      userId: 'user-1',
      actorId: 'user-1',
      deviceId: 'device-1',
      entityId: 'task-1',
      entityType: 'task',
      type: 'TaskCreated',
      schemaVersion: 1,
      payload: { list_id: 'list-1', title: 'Alpha', position: 'a0' },
      clientTimestamp: new Date(),
      vectorClock: { 'device-1': 1 },
      userSeq: 1n,
    })
  })

  afterEach(() => cleanup())

  it('rejects UPDATE', async () => {
    await expect(db.execute(sql`UPDATE events SET type = 'Tampered' WHERE id = 'evt-1'`)).rejects.toThrow(
      /append-only/,
    )
  })

  it('rejects DELETE', async () => {
    await expect(db.execute(sql`DELETE FROM events WHERE id = 'evt-1'`)).rejects.toThrow(/append-only/)
  })

  it('rejects TRUNCATE', async () => {
    // Postgres itself refuses to truncate a table another table has a FK
    // into (undo_entries -> events) unless CASCADE is given; WITH CASCADE
    // reaches our trigger instead. Either way, TRUNCATE never succeeds.
    await expect(db.execute(sql`TRUNCATE events CASCADE`)).rejects.toThrow(/append-only/)
  })

  it('allows INSERT', async () => {
    const rows = await db.select({ id: events.id }).from(events)
    expect(rows).toHaveLength(1)
  })
})
