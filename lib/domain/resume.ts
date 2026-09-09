import type { VectorClock } from '@/lib/events/envelope'
import type { AnyEvent } from '@/lib/events/schemas'
import { CURRENT_SCHEMA_VERSION } from '@/lib/events/factory'
import type { AppState } from './state'

/** Placeholder actor/device for synthetic resume events — never crosses
 * the wire or the AnyEvent Zod boundary, so it doesn't need to be a real
 * user or device, just a stable, valid-looking id. */
const RESUME_ACTOR = '00000000-0000-4000-8000-000000000000'

/**
 * Reconstructs a minimal, self-consistent synthetic event log from an
 * already-resolved AppState (loaded from a snapshot), such that
 * `reduce(resumeEvents(state, ...))` reproduces that exact state, and
 * `reduce([...resumeEvents(...), ...delta])` correctly extends it with
 * events that happened after the snapshot cutoff.
 *
 * This is the "snapshot + delta" resume path (lib/db/snapshots.ts). It
 * lives in lib/domain, not lib/db, because it's the reducer's mirror
 * image and must stay in lock-step with reducer.ts's field list — one
 * synthetic event per field the reducer resolves, each carrying the
 * SAME clock/timestamp (the snapshot's own).
 *
 * This is the standard "single winner per field" LWW-register
 * simplification (docs/DECISIONS.md "Snapshot resume — a documented
 * limitation") — provably exact for any delta that doesn't have a
 * 3-way-or-more unsynced concurrent history on the SAME field straddling
 * the snapshot boundary, which real snapshot cadence (every 200 events)
 * makes vanishingly unlikely, and which is the documented, accepted scope
 * limit of the whole merge strategy (the same limit lib/db/projections.ts
 * avoids only because a single entity's full history is cheap to replay
 * in full — a whole-user snapshot cannot afford that).
 */
export function resumeEvents(state: AppState, clock: VectorClock, atTimestamp: string): AnyEvent[] {
  const out: AnyEvent[] = []
  const base = {
    schema_version: CURRENT_SCHEMA_VERSION,
    actor_id: RESUME_ACTOR,
    device_id: RESUME_ACTOR,
    client_timestamp: atTimestamp,
    server_timestamp: atTimestamp,
    vector_clock: clock,
  }

  for (const task of Object.values(state.tasks)) {
    const common = { ...base, entity_id: task.id, entity_type: 'task' as const }
    out.push({
      ...common,
      // reducer.ts derives `created_at` from the TaskCreated event's own
      // client_timestamp — using the snapshot's cutoff time here instead
      // of the entity's real created_at would silently rewrite that
      // metadata on every resume. The vector_clock (still the snapshot's
      // aggregate clock) is what does the actual merge/dominance work;
      // client_timestamp only breaks a tie between exactly-concurrent
      // clocks, so substituting the true created_at here doesn't weaken
      // that.
      client_timestamp: task.created_at,
      id: `${task.id}:resume:created`,
      type: 'TaskCreated',
      payload: { list_id: task.list_id, title: task.title, position: task.position },
    })
    if (task.completed) {
      out.push({
        ...common,
        id: `${task.id}:resume:completed`,
        type: 'TaskCompleted',
        payload: { completed_at: task.completed_at ?? atTimestamp },
      })
    }
    if (task.due_date !== null) {
      out.push({
        ...common,
        id: `${task.id}:resume:due_date`,
        type: 'TaskDueDateSet',
        payload: { from: null, to: task.due_date },
      })
    }
    if (task.priority !== null) {
      out.push({
        ...common,
        id: `${task.id}:resume:priority`,
        type: 'TaskPriorityChanged',
        payload: { from: null, to: task.priority },
      })
    }
    if (task.note !== null) {
      out.push({ ...common, id: `${task.id}:resume:note`, type: 'NoteAttached', payload: { from: null, to: task.note } })
    }
    for (const tag of task.tags) {
      out.push({ ...common, id: `${task.id}:resume:tag:${tag}`, type: 'TagAdded', payload: { tag } })
    }
    if (task.deleted) {
      out.push({ ...common, id: `${task.id}:resume:deleted`, type: 'TaskDeleted', payload: {} })
    }
  }

  for (const list of Object.values(state.lists)) {
    const common = { ...base, entity_id: list.id, entity_type: 'list' as const }
    out.push({
      ...common,
      client_timestamp: list.created_at, // see the matching TaskCreated comment above
      id: `${list.id}:resume:created`,
      type: 'ListCreated',
      payload: { name: list.name, position: list.position },
    })
    if (list.archived) {
      out.push({ ...common, id: `${list.id}:resume:archived`, type: 'ListArchived', payload: { from: false, to: true } })
    }
  }

  return out as AnyEvent[]
}
