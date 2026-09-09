import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm'
import { reduce, REDUCER_VERSION } from '@/lib/domain/reducer'
import { resumeEvents } from '@/lib/domain/resume'
import { merge as mergeClock } from '@/lib/domain/vector-clock'
import type { AppState } from '@/lib/domain/state'
import type { VectorClock } from '@/lib/events/envelope'
import { events, snapshots } from './schema'
import type { Db } from './client'
import { rowToEvent } from './mappers'

/** Every 200 events, per docs/DECISIONS.md "Snapshot cadence": bounds the
 * worst-case replay at 200 events (deterministic, costs nothing for idle
 * users) without the unbounded-storage-growth risk of a time-based
 * cadence, or the read-path write hazard of write-on-read. */
export const SNAPSHOT_CADENCE = 200
/** How many recent snapshots to retain per user, so a bad/incompatible
 * snapshot can be skipped in favour of the next-older one. */
const SNAPSHOTS_TO_RETAIN = 3

async function latestUsableSnapshot(db: Db, userId: string, atUserSeq?: bigint) {
  const conditions = [eq(snapshots.userId, userId), eq(snapshots.reducerVersion, REDUCER_VERSION)]
  if (atUserSeq !== undefined) conditions.push(lte(snapshots.upToUserSeq, atUserSeq))
  const [row] = await db
    .select()
    .from(snapshots)
    .where(and(...conditions))
    .orderBy(desc(snapshots.upToUserSeq))
    .limit(1)
  return row
}

/**
 * Full state as of a point in time (or "now" when `at` is omitted) —
 * GET /snapshot?at=<timestamp> and the current-state read path share this.
 * Uses the newest usable snapshot (matching REDUCER_VERSION, at or before
 * `at`) as a resume point, reconstructed via lib/domain/resume.ts, then
 * replays only the delta since that snapshot — never the whole log.
 */
export async function getStateAt(db: Db, userId: string, at?: Date): Promise<AppState> {
  const snapshot = await latestUsableSnapshot(db, userId)

  const deltaConditions = [eq(events.userId, userId)]
  if (snapshot) deltaConditions.push(gt(events.userSeq, snapshot.upToUserSeq))
  if (at) deltaConditions.push(lte(events.serverTimestamp, at))

  const deltaRows = await db
    .select()
    .from(events)
    .where(and(...deltaConditions))
    .orderBy(asc(events.userSeq))
  const deltaEvents = deltaRows.map(rowToEvent)

  if (!snapshot) return reduce(deltaEvents)

  // A snapshot taken AFTER `at` is useless for a time-travel query into
  // its own past — fall back to a full replay up to `at` instead of
  // resuming from a too-late resume point.
  if (at && snapshot.upToServerTimestamp > at) {
    const rows = await db
      .select()
      .from(events)
      .where(and(eq(events.userId, userId), lte(events.serverTimestamp, at)))
      .orderBy(asc(events.userSeq))
    return reduce(rows.map(rowToEvent))
  }

  const resume = resumeEvents(
    snapshot.state as AppState,
    snapshot.vectorClock as VectorClock,
    snapshot.upToServerTimestamp.toISOString(),
  )
  return reduce([...resume, ...deltaEvents])
}

/**
 * Creates a new snapshot via a FULL replay up to the user's current
 * high-water mark — snapshot creation itself is always exactly correct
 * (it's just `reduce()` over a real, complete event prefix); only the
 * later snapshot+delta RESUME path carries the documented single-winner
 * simplification. Called after a sync batch crosses a 200-event boundary
 * (lib/sync/server.ts); prunes down to the newest SNAPSHOTS_TO_RETAIN.
 */
export async function createSnapshot(db: Db, userId: string): Promise<void> {
  const rows = await db
    .select()
    .from(events)
    .where(eq(events.userId, userId))
    .orderBy(asc(events.userSeq))
  if (rows.length === 0) return

  const lastRow = rows[rows.length - 1]!
  const state = reduce(rows.map(rowToEvent))
  const vectorClock = rows.reduce<VectorClock>((acc, r) => mergeClock(acc, r.vectorClock as VectorClock), {})

  await db.insert(snapshots).values({
    userId,
    upToUserSeq: lastRow.userSeq,
    upToServerTimestamp: lastRow.serverTimestamp,
    vectorClock,
    state,
    reducerVersion: REDUCER_VERSION,
    eventCount: rows.length,
  })

  const stale = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(eq(snapshots.userId, userId))
    .orderBy(desc(snapshots.upToUserSeq))
    .offset(SNAPSHOTS_TO_RETAIN)
  for (const row of stale) {
    await db.delete(snapshots).where(eq(snapshots.id, row.id))
  }
}

/** Called after every accepted sync batch. Snapshots when the user has
 * crossed a fresh 200-event boundary since the last one. */
export async function maybeCreateSnapshot(db: Db, userId: string): Promise<void> {
  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(events)
    .where(eq(events.userId, userId))
  const total = countRow?.count ?? 0

  const latest = await latestUsableSnapshot(db, userId)
  const sinceLast = total - (latest?.eventCount ?? 0)
  if (sinceLast >= SNAPSHOT_CADENCE) {
    await createSnapshot(db, userId)
  }
}
