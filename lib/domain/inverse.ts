import type { AnyEvent, EventType } from '@/lib/events/schemas'

/**
 * The type + payload of the compensating event for `event`, per the
 * inverse column in lib/events/schemas.ts. Every event type is derivable
 * purely from the event's own fields — none need the state the event was
 * applied to — which keeps this a pure function, as
 * .claude/rules/domain.md requires of everything under lib/domain/.
 *
 * This does NOT mint a new event (no id, no vector_clock, no timestamps —
 * all of that is randomness/state that belongs outside lib/domain). The
 * caller (POST /undo, app/api/undo/route.ts) takes this result and passes
 * it to lib/events/factory.ts `createEvent`, which appends it through the
 * exact same path as any other event (CLAUDE.md principle 5: undo is
 * itself a new event, never a rewrite of history).
 */
export interface InversePayload<T extends EventType = EventType> {
  type: T
  payload: unknown
}

export function inverse(event: AnyEvent): InversePayload {
  switch (event.type) {
    case 'TaskCreated':
      return { type: 'TaskDeleted', payload: {} }
    case 'TaskDeleted':
      return { type: 'TaskRestored', payload: {} }
    case 'TaskRestored':
      return { type: 'TaskDeleted', payload: {} }
    case 'TaskCompleted':
      return { type: 'TaskUncompleted', payload: { prior_completed_at: event.payload.completed_at } }
    case 'TaskUncompleted':
      return { type: 'TaskCompleted', payload: { completed_at: event.payload.prior_completed_at } }
    case 'TagAdded':
      return { type: 'TagRemoved', payload: { tag: event.payload.tag } }
    case 'TagRemoved':
      return { type: 'TagAdded', payload: { tag: event.payload.tag } }
    case 'ListCreated':
      // No ListDeleted type exists (only 15 types, per spec) — undoing a
      // list's creation archives it instead. Documented as a deliberate
      // compromise in docs/DECISIONS.md.
      return { type: 'ListArchived', payload: { from: false, to: true } }

    // Value-replacing events already carry { from, to } — inverting is a
    // pure field swap, no extra lookup required.
    case 'TaskRenamed':
      return { type: 'TaskRenamed', payload: { from: event.payload.to, to: event.payload.from } }
    case 'TaskMoved':
      return { type: 'TaskMoved', payload: { from: event.payload.to, to: event.payload.from } }
    case 'TaskDueDateSet':
      return { type: 'TaskDueDateSet', payload: { from: event.payload.to, to: event.payload.from } }
    case 'TaskPriorityChanged':
      return { type: 'TaskPriorityChanged', payload: { from: event.payload.to, to: event.payload.from } }
    case 'ListRenamed':
      return { type: 'ListRenamed', payload: { from: event.payload.to, to: event.payload.from } }
    case 'ListArchived':
      return { type: 'ListArchived', payload: { from: event.payload.to, to: event.payload.from } }
    case 'NoteAttached':
      return { type: 'NoteAttached', payload: { from: event.payload.to, to: event.payload.from } }
    case 'PreferenceSet':
      return { type: 'PreferenceSet', payload: { key: event.payload.key, from: event.payload.to, to: event.payload.from } }
  }
}
