import { and, desc, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { inverse } from '@/lib/domain/inverse'
import { rebuildProjection } from './projections'
import { allocateUserSeq } from './sequence'
import { rowToEvent } from './mappers'
import { events, undoEntries } from './schema'
import type { Db } from './client'
import { CURRENT_SCHEMA_VERSION } from '@/lib/events/factory'

/**
 * Undo/redo stack (POST /undo, POST /redo), per docs/DECISIONS.md "Undo/
 * redo stack". Deliberately per (user_id, device_id): a device undoes only
 * its OWN most recent action, never another device's — undoing someone
 * else's concurrent edit from across the room is a confusing UX this
 * scope doesn't attempt to solve.
 *
 * `undo_entries` is NOT part of the immutable event log (CLAUDE.md
 * principle 1 constrains `events`, not this bookkeeping table) — it's a
 * 3-state machine per entry: 'active' (undoable) -> 'undone' (redoable)
 * -> 'superseded' (a newer real action pushed it out of the redo stack,
 * standard undo/redo UX). The compensating event itself, though, IS a
 * normal event appended through the exact same path as any user action —
 * undo is never a history rewrite.
 */

async function appendCompensatingEvent(
  db: Db,
  userId: string,
  deviceId: string,
  targetEventId: string,
): Promise<{ id: string; userSeq: bigint } | null> {
  const [row] = await db.select().from(events).where(eq(events.id, targetEventId))
  if (!row) return null
  const target = rowToEvent(row)
  const inv = inverse(target)

  const highestSeq = await allocateUserSeq(db, userId, 1)
  const newEvent = {
    id: uuidv7(),
    userId,
    actorId: userId,
    deviceId,
    entityId: target.entity_id,
    entityType: target.entity_type,
    type: inv.type,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    payload: inv.payload,
    clientTimestamp: new Date(),
    vectorClock: target.vector_clock,
    userSeq: highestSeq,
  }
  const [inserted] = await db.insert(events).values(newEvent).returning({ id: events.id, userSeq: events.userSeq })
  await rebuildProjection(db, userId, target.entity_type, target.entity_id)
  return inserted ?? null
}

/** Called by POST /sync (or wherever a genuinely new, non-undo/redo event
 * is appended) so a fresh action always pushes a new 'active' stack entry
 * and invalidates any pending redo — standard undo/redo UX. */
export async function pushUndoEntry(db: Db, userId: string, deviceId: string, eventId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(undoEntries)
      .set({ state: 'superseded', updatedAt: new Date() })
      .where(and(eq(undoEntries.userId, userId), eq(undoEntries.deviceId, deviceId), eq(undoEntries.state, 'undone')))
    await tx.insert(undoEntries).values({ userId, deviceId, eventId, state: 'active' })
  })
}

export async function undo(db: Db, userId: string, deviceId: string): Promise<{ event_id: string; user_seq: number } | null> {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(undoEntries)
      .where(and(eq(undoEntries.userId, userId), eq(undoEntries.deviceId, deviceId), eq(undoEntries.state, 'active')))
      .orderBy(desc(undoEntries.id))
      .limit(1)
    if (!entry) return null

    const compensating = await appendCompensatingEvent(tx, userId, deviceId, entry.eventId)
    if (!compensating) return null

    await tx
      .update(undoEntries)
      .set({ compensatingEventId: compensating.id, state: 'undone', updatedAt: new Date() })
      .where(eq(undoEntries.id, entry.id))

    return { event_id: compensating.id, user_seq: Number(compensating.userSeq) }
  })
}

export async function redo(db: Db, userId: string, deviceId: string): Promise<{ event_id: string; user_seq: number } | null> {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(undoEntries)
      .where(and(eq(undoEntries.userId, userId), eq(undoEntries.deviceId, deviceId), eq(undoEntries.state, 'undone')))
      .orderBy(desc(undoEntries.id))
      .limit(1)
    if (!entry || !entry.compensatingEventId) return null

    const compensating = await appendCompensatingEvent(tx, userId, deviceId, entry.compensatingEventId)
    if (!compensating) return null

    // The entry now points at the redo-event as its (re-)active target,
    // so a FOLLOWING undo correctly undoes THIS redo, not the stale
    // original.
    await tx
      .update(undoEntries)
      .set({ eventId: compensating.id, compensatingEventId: null, state: 'active', updatedAt: new Date() })
      .where(eq(undoEntries.id, entry.id))

    return { event_id: compensating.id, user_seq: Number(compensating.userSeq) }
  })
}
