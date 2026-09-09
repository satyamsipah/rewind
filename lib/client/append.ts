import type { EntityType } from '@/lib/events/envelope'
import { createEvent, type CreateEventInput } from '@/lib/events/factory'
import type { AnyEvent, EventType } from '@/lib/events/schemas'
import { db } from './db'
import { nextLocalClock } from './clock'
import { rebuildLocalProjection } from './projection'
import { getCachedUserId, getOrCreateDeviceId } from './identity'

/**
 * The one place a locally-minted event actually gets written: log +
 * outbox + projection, in one Dexie transaction so the UI never observes
 * a half-applied mutation. This is the "write locally first, optimistic
 * update, queue for sync" path CLAUDE.md principle 3 requires — there is
 * no network call anywhere in this function.
 *
 * Deliberately separate from lib/client/mutations.ts (which also pushes
 * an undo-stack entry) and lib/client/undo.ts (which calls this directly
 * WITHOUT pushing one, since a compensating event is never itself
 * undoable as a "new action" — see lib/client/undo.ts).
 */
export async function appendLocalEvent<T extends EventType>(
  input: Omit<CreateEventInput<T>, 'actor_id' | 'device_id' | 'vector_clock'>,
): Promise<AnyEvent> {
  const actorId = getCachedUserId()
  if (!actorId) throw new Error('cannot write events before a user has signed in at least once')
  const deviceId = getOrCreateDeviceId()
  const clock = await nextLocalClock()

  const event = createEvent({ ...input, actor_id: actorId, device_id: deviceId, vector_clock: clock } as CreateEventInput<T>)

  await db.transaction('rw', db.events, db.outbox, async () => {
    await db.events.put(event)
    await db.outbox.put({ id: event.id, createdAt: Date.now() })
  })
  await rebuildLocalProjection(event.entity_id, event.entity_type as EntityType)

  return event
}
