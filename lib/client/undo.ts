import { inverse } from '@/lib/domain/inverse'
import type { AnyEvent } from '@/lib/events/schemas'
import { appendLocalEvent } from './append'
import { db, type UndoEntryRow } from './db'
import { notifyLocalMutation } from './sync-engine'

/**
 * Client-owned undo/redo — see docs/DECISIONS.md "Undo/redo: client-owned
 * for offline support". This is the SAME 3-state machine
 * (active/undone/superseded) lib/db/undo.ts implements server-side, but
 * authoritative here: undo/redo must work with zero round trips, so the
 * client can't defer to the server's stack to know what's on top of it.
 *
 * The compensating event is minted through the exact same
 * `appendLocalEvent` path as any user action (never a history rewrite —
 * CLAUDE.md principle 1) and syncs up like any other event; the
 * server-side stack (still correct, still usable for a future
 * server-driven surface) simply isn't the primary path anymore.
 */

/** Called by lib/client/mutations.ts after every genuinely new local
 * action — never by undo()/redo() for their own compensating events. */
export async function pushUndoEntry(eventId: string): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.undoStack, async () => {
    // A new real action invalidates any pending redo — standard
    // undo/redo UX (docs/DECISIONS.md).
    const undoneEntries = await db.undoStack.where('state').equals('undone').toArray()
    await db.undoStack.bulkPut(undoneEntries.map((e) => ({ ...e, state: 'superseded' as const, updatedAt: now })))
    await db.undoStack.add({ eventId, compensatingEventId: null, state: 'active', createdAt: now, updatedAt: now })
  })
}

async function appendCompensatingEvent(target: AnyEvent): Promise<AnyEvent> {
  const inv = inverse(target)
  return appendLocalEvent({
    type: inv.type,
    entity_id: target.entity_id,
    entity_type: target.entity_type,
    payload: inv.payload as never,
  })
}

export interface UndoRedoResult {
  event: AnyEvent
}

export async function undo(): Promise<UndoRedoResult | null> {
  const target = await latestOf('active')
  if (!target) return null

  const originalEvent = await db.events.get(target.eventId)
  if (!originalEvent) return null

  const compensating = await appendCompensatingEvent(originalEvent)
  await db.undoStack.update(target.id!, {
    compensatingEventId: compensating.id,
    state: 'undone',
    updatedAt: Date.now(),
  })
  notifyLocalMutation()
  return { event: compensating }
}

export async function redo(): Promise<UndoRedoResult | null> {
  const target = await latestOf('undone')
  if (!target || !target.compensatingEventId) return null

  const compensatingSource = await db.events.get(target.compensatingEventId)
  if (!compensatingSource) return null

  const redone = await appendCompensatingEvent(compensatingSource)
  // The entry now points at the redo event as its active target, so a
  // FOLLOWING undo correctly undoes THIS redo, not the stale original.
  await db.undoStack.update(target.id!, {
    eventId: redone.id,
    compensatingEventId: null,
    state: 'active',
    updatedAt: Date.now(),
  })
  notifyLocalMutation()
  return { event: redone }
}

/**
 * Most recent entry in a given state, ordered by `updatedAt` (the last
 * time THIS entry changed state) — not `id` (when it was first created).
 * Those two orderings agree until an entry has been through more than one
 * undo/redo cycle relative to its neighbours; sorting by `id` alone picks
 * the wrong entry once that happens (redo would restore actions in the
 * wrong order). `sortBy` scans in JS rather than using an index, which is
 * fine — this table is bounded by one user's action count.
 */
async function latestOf(state: UndoEntryRow['state']): Promise<UndoEntryRow | undefined> {
  const rows = await db.undoStack.where('state').equals(state).sortBy('updatedAt')
  return rows[rows.length - 1]
}

export async function canUndo(): Promise<boolean> {
  return (await latestOf('active')) !== undefined
}

export async function canRedo(): Promise<boolean> {
  return (await latestOf('undone')) !== undefined
}
