#!/usr/bin/env tsx
/**
 * Seeds one real, already-signed-in user with a rich, ~24-day event
 * history so the time-travel view has something to scrub through on
 * first look — "an empty app demos nothing" (this prompt's item 2).
 *
 * Writes directly to `events` (bypassing POST /sync entirely — this is a
 * one-time operator action against a real signed-in account, not a
 * simulated client) using the exact same event schemas, factory-style
 * shape, and reduce()/rebuildProjection() the app itself runs, so the
 * seeded history is indistinguishable from one a real client produced.
 * See docs/DECISIONS.md "Demo strategy: a real seeded account".
 *
 * Usage: DATABASE_URL=<production URL> pnpm tsx scripts/seed-demo.ts [email]
 * `email` is optional — if omitted, this requires exactly one row in
 * `user` (true for a freshly-seeded demo deployment) and seeds that one.
 */
import { v7 as uuidv7 } from 'uuid'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { devices, events, undoEntries, users } from '@/lib/db/schema'
import { allocateUserSeq } from '@/lib/db/sequence'
import { rebuildProjection } from '@/lib/db/projections'
import { AnyEvent } from '@/lib/events/schemas'
import { CURRENT_SCHEMA_VERSION } from '@/lib/events/factory'
import { increment } from '@/lib/domain/vector-clock'
import type { VectorClock } from '@/lib/events/envelope'

const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(n: number, hour = 10): Date {
  const d = new Date(Date.now() - n * DAY_MS)
  d.setUTCHours(hour, 0, 0, 0)
  return d
}

interface Draft {
  offsetDays: number
  hour?: number
  entityType: 'task' | 'list'
  entityId: string
  type: string
  payload: unknown
}

async function main() {
  const email = process.argv[2]
  const db = getDb()

  const rows = email ? await db.select().from(users).where(eq(users.email, email)) : await db.select().from(users)
  if (rows.length === 0) throw new Error(email ? `no user with email ${email}` : 'no users found — sign in once first')
  if (rows.length > 1) throw new Error(`${rows.length} users found — pass an email to disambiguate`)
  const user = rows[0]!
  console.log(`Seeding for ${user.email ?? user.id}`)

  const deviceId = uuidv7()
  await db.insert(devices).values({ id: deviceId, userId: user.id, name: 'Demo — MacBook Pro' })

  const workList = uuidv7()
  const personalList = uuidv7()
  const tRoadmap = uuidv7()
  const tReviewPr = uuidv7()
  const tRenewSsl = uuidv7()
  const tPrepDemo = uuidv7()
  const tDentist = uuidv7()
  const tWeekendTrip = uuidv7()
  const tBirthdayGift = uuidv7()
  const tFlakyTest = uuidv7()
  const tReadmeShots = uuidv7()

  const drafts: Draft[] = [
    { offsetDays: 24, entityType: 'list', entityId: workList, type: 'ListCreated', payload: { name: 'Work', position: 'a0' } },
    { offsetDays: 24, hour: 10.1, entityType: 'list', entityId: personalList, type: 'ListCreated', payload: { name: 'Personal', position: 'a1' } },

    { offsetDays: 23, entityType: 'task', entityId: tRoadmap, type: 'TaskCreated', payload: { list_id: workList, title: 'Draft Q3 roadmap', position: 'a0' } },
    { offsetDays: 23, hour: 10.1, entityType: 'task', entityId: tReviewPr, type: 'TaskCreated', payload: { list_id: workList, title: 'Review PR #142', position: 'a1' } },
    { offsetDays: 23, hour: 10.2, entityType: 'task', entityId: tRenewSsl, type: 'TaskCreated', payload: { list_id: workList, title: 'Renew SSL cert', position: 'a2' } },
    { offsetDays: 23, hour: 10.3, entityType: 'task', entityId: tPrepDemo, type: 'TaskCreated', payload: { list_id: workList, title: 'Prep demo for Friday', position: 'a3' } },

    { offsetDays: 22, entityType: 'task', entityId: tDentist, type: 'TaskCreated', payload: { list_id: personalList, title: 'Book dentist appointment', position: 'a0' } },
    { offsetDays: 22, hour: 11.1, entityType: 'task', entityId: tWeekendTrip, type: 'TaskCreated', payload: { list_id: personalList, title: 'Plan weekend trip', position: 'a1' } },
    { offsetDays: 22, hour: 11.2, entityType: 'task', entityId: tBirthdayGift, type: 'TaskCreated', payload: { list_id: personalList, title: "Buy Mia's birthday gift", position: 'a2' } },

    { offsetDays: 20, entityType: 'task', entityId: tPrepDemo, type: 'TaskDueDateSet', payload: { from: null, to: daysAgo(16).toISOString() } },
    { offsetDays: 20, hour: 9.1, entityType: 'task', entityId: tPrepDemo, type: 'TaskPriorityChanged', payload: { from: null, to: 'high' } },
    { offsetDays: 20, hour: 9.2, entityType: 'task', entityId: tRenewSsl, type: 'TaskDueDateSet', payload: { from: null, to: daysAgo(9).toISOString() } },

    { offsetDays: 18, entityType: 'task', entityId: tRenewSsl, type: 'TagAdded', payload: { tag: 'urgent' } },
    { offsetDays: 18, hour: 9.1, entityType: 'task', entityId: tReviewPr, type: 'TagAdded', payload: { tag: 'backend' } },

    { offsetDays: 15, entityType: 'task', entityId: tReviewPr, type: 'TaskCompleted', payload: { completed_at: daysAgo(15).toISOString() } },

    { offsetDays: 14, entityType: 'task', entityId: tRoadmap, type: 'TaskRenamed', payload: { from: 'Draft Q3 roadmap', to: 'Draft Q3 roadmap v2' } },

    {
      offsetDays: 12,
      entityType: 'task',
      entityId: tBirthdayGift,
      type: 'TaskMoved',
      payload: {
        from: { list_id: personalList, position: 'a2' },
        to: { list_id: workList, position: 'a4' },
      },
    },

    { offsetDays: 10, entityType: 'task', entityId: tPrepDemo, type: 'NoteAttached', payload: { from: null, to: 'Focus on the time-travel demo section — that is the whole pitch.' } },

    { offsetDays: 8, entityType: 'task', entityId: tFlakyTest, type: 'TaskCreated', payload: { list_id: workList, title: 'Fix flaky e2e test (divergence.test.ts)', position: 'a5' } },
    { offsetDays: 8, hour: 15.1, entityType: 'task', entityId: tRenewSsl, type: 'TaskCompleted', payload: { completed_at: daysAgo(8, 15).toISOString() } },

    { offsetDays: 6, entityType: 'task', entityId: tDentist, type: 'TaskDeleted', payload: {} },
    { offsetDays: 6, hour: 16.1, entityType: 'task', entityId: tDentist, type: 'TaskRestored', payload: {} },

    // A genuine undo: complete, then a compensating TaskUncompleted — also
    // recorded in undo_entries below, exactly as POST /undo would.
    { offsetDays: 5, entityType: 'task', entityId: tFlakyTest, type: 'TaskCompleted', payload: { completed_at: daysAgo(5).toISOString() } },
    { offsetDays: 5, hour: 10.1, entityType: 'task', entityId: tFlakyTest, type: 'TaskUncompleted', payload: { prior_completed_at: daysAgo(5).toISOString() } },

    { offsetDays: 3, entityType: 'task', entityId: tWeekendTrip, type: 'TaskPriorityChanged', payload: { from: null, to: 'medium' } },
    { offsetDays: 3, hour: 9.1, entityType: 'task', entityId: tWeekendTrip, type: 'TagAdded', payload: { tag: 'travel' } },

    { offsetDays: 1, entityType: 'task', entityId: tPrepDemo, type: 'TaskCompleted', payload: { completed_at: daysAgo(1).toISOString() } },

    { offsetDays: 0, hour: 9, entityType: 'task', entityId: tReadmeShots, type: 'TaskCreated', payload: { list_id: workList, title: 'Write README screenshots', position: 'a6' } },
    { offsetDays: 0, hour: 9.1, entityType: 'task', entityId: tReadmeShots, type: 'TaskDueDateSet', payload: { from: null, to: daysAgo(0).toISOString() } },
    { offsetDays: 0, hour: 9.2, entityType: 'task', entityId: tReadmeShots, type: 'TaskPriorityChanged', payload: { from: null, to: 'high' } },
  ]

  let clock: VectorClock = {}
  const built: AnyEvent[] = drafts.map((d) => {
    clock = increment(clock, deviceId)
    const ts = daysAgo(d.offsetDays, d.hour ?? 10).toISOString()
    const candidate = {
      id: uuidv7(),
      schema_version: CURRENT_SCHEMA_VERSION,
      actor_id: user.id,
      device_id: deviceId,
      entity_id: d.entityId,
      entity_type: d.entityType,
      client_timestamp: ts,
      server_timestamp: ts,
      vector_clock: clock,
      type: d.type,
      payload: d.payload,
    }
    return AnyEvent.parse(candidate)
  })

  const { undoEventId, redoEventId } = (() => {
    const completed = built.find((e) => e.type === 'TaskCompleted' && e.entity_id === tFlakyTest)!
    const uncompleted = built.find((e) => e.type === 'TaskUncompleted' && e.entity_id === tFlakyTest)!
    return { undoEventId: completed.id, redoEventId: uncompleted.id }
  })()

  await db.transaction(async (tx) => {
    const end = await allocateUserSeq(tx, user.id, built.length)
    const start = end - BigInt(built.length)

    await tx.insert(events).values(
      built.map((e, i) => ({
        id: e.id,
        userId: user.id,
        actorId: e.actor_id,
        deviceId: e.device_id,
        entityId: e.entity_id,
        entityType: e.entity_type,
        type: e.type,
        schemaVersion: e.schema_version,
        payload: e.payload,
        clientTimestamp: new Date(e.client_timestamp),
        serverTimestamp: new Date(e.server_timestamp!),
        vectorClock: e.vector_clock,
        userSeq: start + BigInt(i + 1),
      })),
    )

    await tx.insert(undoEntries).values({
      userId: user.id,
      deviceId,
      eventId: undoEventId,
      compensatingEventId: redoEventId,
      state: 'active',
    })
  })

  const entityKeys = new Set(built.map((e) => `${e.entity_type}:${e.entity_id}`))
  for (const key of entityKeys) {
    const [entityType, entityId] = key.split(':') as ['task' | 'list', string]
    await rebuildProjection(db, user.id, entityType, entityId)
  }

  console.log(`Seeded ${built.length} events across ${entityKeys.size} entities.`)
  console.log(`History spans ${drafts[0]!.offsetDays} days ago -> today.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
