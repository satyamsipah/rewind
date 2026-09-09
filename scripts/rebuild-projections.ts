#!/usr/bin/env tsx
/**
 * Rebuilds every projection row for every user from the raw event log —
 * the operational escape hatch for "the cache disagrees with the log"
 * (a reducer bug, a manual DB fix, whatever). Safe to run at any time:
 * lib/db/projections.ts's rebuildProjection is a full per-entity replay,
 * never an incremental patch, so this is idempotent.
 *
 * Usage: pnpm db:rebuild-projections
 */
import { getDb } from '@/lib/db/client'
import { events } from '@/lib/db/schema'
import { rebuildProjection } from '@/lib/db/projections'

async function main() {
  const db = getDb()
  const entities = await db
    .select({
      userId: events.userId,
      entityId: events.entityId,
      entityType: events.entityType,
    })
    .from(events)
    .groupBy(events.userId, events.entityId, events.entityType)

  console.log(`Rebuilding ${entities.length} entity projection(s)...`)
  let done = 0
  for (const { userId, entityId, entityType } of entities) {
    await rebuildProjection(db, userId, entityType as 'task' | 'list', entityId)
    done += 1
    if (done % 100 === 0) console.log(`  ${done}/${entities.length}`)
  }
  console.log(`Done: ${done} projection(s) rebuilt.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
