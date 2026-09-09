import { z } from 'zod'
import { EventEnvelope } from './envelope'

/**
 * The original 15 event types for Rewind, plus `PreferenceSet` added for
 * the UI phase (docs/DECISIONS.md "Preference sync"). Two shape decisions
 * apply across the union (see docs/DECISIONS.md for the full rationale):
 *
 * - Value-replacing events carry `{ from, to }`. This makes `inverse()`
 *   (lib/domain/inverse.ts) a pure function of the event alone — no
 *   replay-to-a-point needed — and gives field-level merge (lib/domain/
 *   merge.ts) a cheap "what did this write" handle. It's also why
 *   `ListArchived` and `NoteAttached` are set-events rather than needing
 *   separate unarchive/detach types.
 * - `TaskMoved` groups `list_id` and `position` as one atomic pair, so a
 *   concurrent move can never land a task in one device's list at another
 *   device's position (see lib/domain/merge.ts `move` field).
 *
 * Positions are fractional-index strings (e.g. "a0", "a0V"), not integers,
 * so concurrent inserts between the same two neighbours never require a
 * renumbering pass.
 */

export const Priority = z.enum(['low', 'medium', 'high'])
export type Priority = z.infer<typeof Priority>

const Position = z.string().min(1)
const IsoDateOrNull = z.string().datetime({ offset: true }).nullable()

function event<Type extends string, Payload extends z.ZodTypeAny>(type: Type, payload: Payload) {
  return EventEnvelope.extend({
    type: z.literal(type),
    payload,
  })
}

export const TaskCreated = event(
  'TaskCreated',
  z.object({
    list_id: z.string().uuid(),
    title: z.string().min(1),
    position: Position,
    // Optional, defaults to null (top-level task) — added for subtasks
    // without a schema_version bump. `.optional()` here means an older
    // client's event (minted before subtasks existed) still validates
    // unchanged, and the reducer treats a missing field exactly like an
    // explicit null (reducer.ts `buildTask`). See docs/DECISIONS.md
    // "Subtasks: additive optional field, not a version bump".
    parent_task_id: z.string().uuid().nullable().optional(),
  }),
)

export const TaskRenamed = event(
  'TaskRenamed',
  z.object({ from: z.string(), to: z.string().min(1) }),
)

export const TaskCompleted = event(
  'TaskCompleted',
  z.object({ completed_at: z.string().datetime({ offset: true }) }),
)

export const TaskUncompleted = event(
  'TaskUncompleted',
  z.object({ prior_completed_at: z.string().datetime({ offset: true }) }),
)

export const TaskDeleted = event('TaskDeleted', z.object({}))

export const TaskRestored = event('TaskRestored', z.object({}))

// parent_task_id travels in the SAME atomic pair as list_id/position, for
// the same reason list_id and position do (docs/DECISIONS.md): a
// concurrent re-parent and a concurrent list-move must never merge into a
// task that's in one device's list AND another device's parent at once.
const MoveEndpoint = z.object({
  list_id: z.string().uuid(),
  position: Position,
  parent_task_id: z.string().uuid().nullable().optional(),
})
export const TaskMoved = event(
  'TaskMoved',
  z.object({ from: MoveEndpoint, to: MoveEndpoint }),
)

export const TaskDueDateSet = event(
  'TaskDueDateSet',
  z.object({ from: IsoDateOrNull, to: IsoDateOrNull }),
)

export const TaskPriorityChanged = event(
  'TaskPriorityChanged',
  z.object({ from: Priority.nullable(), to: Priority.nullable() }),
)

export const TagAdded = event('TagAdded', z.object({ tag: z.string().min(1) }))

export const TagRemoved = event('TagRemoved', z.object({ tag: z.string().min(1) }))

export const ListCreated = event(
  'ListCreated',
  z.object({ name: z.string().min(1), position: Position }),
)

export const ListRenamed = event(
  'ListRenamed',
  z.object({ from: z.string(), to: z.string().min(1) }),
)

export const ListArchived = event(
  'ListArchived',
  z.object({ from: z.boolean(), to: z.boolean() }),
)

export const NoteAttached = event(
  'NoteAttached',
  z.object({ from: z.string().nullable(), to: z.string().nullable() }),
)

/**
 * A generic user preference write — `entity_type: 'user'`,
 * `entity_id: <the user's own id>`. One event type covers every current
 * and future preference (docs/DECISIONS.md "Preference sync"): `key` is a
 * closed-but-extensible enum, `from`/`to` are opaque strings (a plain
 * value for an enum-like preference such as theme mode, or JSON for a
 * structured one such as a custom theme's derived token set). Merges via
 * plain LWW-register per key (lib/domain/reducer.ts `buildPreferences`) —
 * last device to change a personal setting wins; there's no data-loss
 * risk in a single scalar preference the way there is with `tags`.
 */
export const PreferenceKey = z.enum(['theme_mode', 'theme_accent', 'theme_custom'])
export type PreferenceKey = z.infer<typeof PreferenceKey>

export const PreferenceSet = event(
  'PreferenceSet',
  z.object({ key: PreferenceKey, from: z.string().nullable(), to: z.string().nullable() }),
)

export const EVENT_SCHEMAS = {
  TaskCreated,
  TaskRenamed,
  TaskCompleted,
  TaskUncompleted,
  TaskDeleted,
  TaskRestored,
  TaskMoved,
  TaskDueDateSet,
  TaskPriorityChanged,
  TagAdded,
  TagRemoved,
  ListCreated,
  ListRenamed,
  ListArchived,
  NoteAttached,
  PreferenceSet,
} as const

export type EventType = keyof typeof EVENT_SCHEMAS

/** Every event type name, for exhaustiveness checks in tests and switches. */
export const EVENT_TYPES = Object.keys(EVENT_SCHEMAS) as EventType[]

export const AnyEvent = z.discriminatedUnion('type', [
  TaskCreated,
  TaskRenamed,
  TaskCompleted,
  TaskUncompleted,
  TaskDeleted,
  TaskRestored,
  TaskMoved,
  TaskDueDateSet,
  TaskPriorityChanged,
  TagAdded,
  TagRemoved,
  ListCreated,
  ListRenamed,
  ListArchived,
  NoteAttached,
  PreferenceSet,
])
export type AnyEvent = z.infer<typeof AnyEvent>

export type EventOfType<T extends EventType> = z.infer<(typeof EVENT_SCHEMAS)[T]>
