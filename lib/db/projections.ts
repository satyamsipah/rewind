import { and, asc, eq } from 'drizzle-orm'
import { reduce } from '@/lib/domain/reducer'
import type { EntityType } from '@/lib/events/envelope'
import { events, projections } from './schema'
import type { Db } from './client'
import { rowToEvent } from './mappers'

/**
 * Rebuilds ONE entity's cached projection by replaying its full event
 * slice (indexed by entity_id — drizzle/0001) through the same
 * lib/domain reduce() the client runs. A full replay of a bounded,
 * per-entity slice rather than an incremental field-by-field merge, so it
 * sidesteps the correctness gap naive incremental LWW-register updates
 * have under 3+-way concurrent writers (docs/DECISIONS.md) — the cache is
 * always exactly what a full replay would produce.
 *
 * Called once per distinct entity touched by a sync batch (lib/sync/
 * server.ts), and by scripts/rebuild-projections.ts for a full rebuild.
 */
export async function rebuildProjection(
  db: Db,
  userId: string,
  entityType: EntityType,
  entityId: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.entityId, entityId)))
    .orderBy(asc(events.userSeq))

  if (rows.length === 0) return

  const state = reduce(rows.map(rowToEvent))
  const entityState = entityType === 'task' ? state.tasks[entityId] : state.lists[entityId]
  if (!entityState) return

  const lastRow = rows[rows.length - 1]!

  await db
    .insert(projections)
    .values({
      userId,
      entityType,
      entityId,
      state: entityState,
      lastUserSeq: lastRow.userSeq,
    })
    .onConflictDoUpdate({
      target: [projections.userId, projections.entityType, projections.entityId],
      set: { state: entityState, lastUserSeq: lastRow.userSeq, updatedAt: new Date() },
    })
}
