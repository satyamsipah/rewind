import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { rowToEvent } from '@/lib/db/mappers'
import { rebuildProjection } from '@/lib/db/projections'
import { allocateUserSeq } from '@/lib/db/sequence'
import { maybeCreateSnapshot } from '@/lib/db/snapshots'
import { pushUndoEntry } from '@/lib/db/undo'
import { events, syncState } from '@/lib/db/schema'
import { merge as mergeClock } from '@/lib/domain/vector-clock'
import type { EntityType, VectorClock } from '@/lib/events/envelope'
import { upcast } from '@/lib/events/upcast'
import { AnyEvent } from '@/lib/events/schemas'
import { PULL_PAGE_SIZE, type SyncRequestT, type SyncResponseT } from './protocol'

/**
 * The server half of POST /sync (docs/DECISIONS.md "Sync protocol"). Runs
 * as a single transaction so a client that times out mid-request can
 * safely resend the identical batch: the dedupe-then-insert steps below
 * make that resend a pure no-op (CLAUDE.md principle 4).
 */
export async function syncPush(db: Db, userId: string, input: SyncRequestT): Promise<SyncResponseT> {
  // Step 1/2: validate + upcast the WHOLE batch before touching the
  // database. Any failure rejects the entire batch atomically — a
  // partial accept could leave a causal hole (docs/DECISIONS.md).
  const rejected: SyncResponseT['rejected'] = []
  const validEvents: AnyEvent[] = []
  for (const raw of input.events) {
    const parsed = AnyEvent.safeParse(raw)
    if (!parsed.success) {
      const id = typeof raw === 'object' && raw && 'id' in raw && typeof raw.id === 'string' ? raw.id : 'unknown'
      rejected.push({ id, reason: 'schema_invalid' })
      continue
    }
    if (parsed.data.actor_id !== userId) {
      rejected.push({ id: parsed.data.id, reason: 'actor_mismatch' })
      continue
    }
    validEvents.push(upcast(parsed.data))
  }
  if (rejected.length > 0) {
    return { accepted: [], duplicates: [], rejected, events: [], server_clock: {}, next_seq: input.since_seq, has_more: false }
  }

  let insertedCount = 0

  const response = await db.transaction(async (tx) => {
    // Step 3/4: dedupe by id — the idempotency mechanism. Seq numbers get
    // allocated only to genuinely-new events, so a replayed batch burns
    // nothing (CLAUDE.md principle 4).
    const ids = validEvents.map((e) => e.id)
    const existing =
      ids.length > 0
        ? await tx.select({ id: events.id }).from(events).where(and(eq(events.userId, userId), inArray(events.id, ids)))
        : []
    const existingIds = new Set(existing.map((r) => r.id))
    const newEvents = validEvents.filter((e) => !existingIds.has(e.id))
    const duplicates = validEvents.filter((e) => existingIds.has(e.id)).map((e) => e.id)

    let accepted: SyncResponseT['accepted'] = []
    if (newEvents.length > 0) {
      // Step 3: the row lock in allocateUserSeq is what makes user_seq a
      // safe, gapless sync cursor — see docs/DECISIONS.md.
      const highestSeq = await allocateUserSeq(tx, userId, newEvents.length)
      const startSeq = highestSeq - BigInt(newEvents.length) + 1n

      const rowsToInsert = newEvents.map((e, i) => ({
        id: e.id,
        userId,
        actorId: e.actor_id,
        deviceId: e.device_id,
        entityId: e.entity_id,
        entityType: e.entity_type,
        type: e.type,
        schemaVersion: e.schema_version,
        payload: e.payload,
        clientTimestamp: new Date(e.client_timestamp),
        vectorClock: e.vector_clock,
        userSeq: startSeq + BigInt(i),
      }))

      // Step 5: ON CONFLICT DO NOTHING is defence in depth against a race
      // between the dedupe SELECT above and this INSERT — the row lock
      // taken in allocateUserSeq already serialises concurrent batches
      // for this user, so this should never actually trigger.
      const inserted = await tx
        .insert(events)
        .values(rowsToInsert)
        .onConflictDoNothing({ target: events.id })
        .returning({ id: events.id, userSeq: events.userSeq, serverTimestamp: events.serverTimestamp })

      accepted = inserted.map((r) => ({
        id: r.id,
        user_seq: Number(r.userSeq),
        server_timestamp: r.serverTimestamp.toISOString(),
      }))
      insertedCount = inserted.length

      // Step 7: fold new events into the per-entity projection cache,
      // through the exact reducer the client runs (lib/db/projections.ts).
      const touchedEntities = new Map<string, EntityType>()
      for (const e of newEvents) touchedEntities.set(e.entity_id, e.entity_type)
      for (const [entityId, entityType] of touchedEntities) {
        await rebuildProjection(tx, userId, entityType, entityId)
      }

      // Every genuinely new client-submitted event is a real user action
      // and pushes its own undo-stack entry (lib/db/undo.ts) — never done
      // for the compensating events undo/redo append themselves, since
      // those go through lib/db/undo.ts directly, not through this path.
      const deviceById = new Map(newEvents.map((e) => [e.id, e.device_id]))
      for (const r of inserted) {
        const deviceId = deviceById.get(r.id)
        if (deviceId) await pushUndoEntry(tx, userId, deviceId, r.id)
      }
    }

    // Step 6: record this device's clock and presence.
    await tx
      .insert(syncState)
      .values({ userId, deviceId: input.device_id, deviceClock: input.client_clock, lastSeenAt: new Date() })
      .onConflictDoUpdate({
        target: [syncState.userId, syncState.deviceId],
        set: { deviceClock: input.client_clock, lastSeenAt: new Date() },
      })

    // Step 8: pull everything this device hasn't seen yet.
    const sinceSeq = BigInt(input.since_seq)
    const pullConditions = [eq(events.userId, userId), gt(events.userSeq, sinceSeq)]
    if (!input.include_own) pullConditions.push(ne(events.deviceId, input.device_id))

    const page = await tx
      .select()
      .from(events)
      .where(and(...pullConditions))
      .orderBy(asc(events.userSeq))
      .limit(PULL_PAGE_SIZE + 1)

    const hasMore = page.length > PULL_PAGE_SIZE
    const pageRows = hasMore ? page.slice(0, PULL_PAGE_SIZE) : page
    const pulledEvents = pageRows.map(rowToEvent)

    // next_seq: capped to the last row actually returned when there's
    // more to page through; otherwise the user's current high-water
    // mark, which — since everything above ran in this same transaction
    // — already reflects this batch's own accepted events too.
    let nextSeq: bigint
    if (hasMore) {
      nextSeq = pageRows[pageRows.length - 1]!.userSeq
    } else {
      const [row] = await tx
        .select({ maxSeq: sql<string | null>`MAX(${events.userSeq})` })
        .from(events)
        .where(eq(events.userId, userId))
      nextSeq = row?.maxSeq ? BigInt(row.maxSeq) : sinceSeq
    }

    // server_clock: the merged view of every device's last-known clock
    // for this user — cheap (bounded by device count, not event count).
    const deviceRows = await tx.select({ deviceClock: syncState.deviceClock }).from(syncState).where(eq(syncState.userId, userId))
    const serverClock = deviceRows.reduce<VectorClock>(
      (acc, row) => mergeClock(acc, (row.deviceClock as VectorClock) ?? {}),
      {},
    )

    return {
      accepted,
      duplicates,
      rejected: [],
      events: pulledEvents,
      server_clock: serverClock,
      next_seq: Number(nextSeq),
      has_more: hasMore,
    }
  })

  // Step 9, "after commit": snapshotting runs in its own transaction,
  // outside the critical path above, so it never holds up (or gets
  // rolled back by) the sync response itself.
  if (insertedCount > 0) {
    await maybeCreateSnapshot(db, userId)
  }

  return response
}
