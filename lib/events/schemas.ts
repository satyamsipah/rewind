import { z } from 'zod'
import { EventEnvelope } from './envelope'

/**
 * The 15 event types for Rewind, exactly as specified. Two shape decisions
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
  z.object({ list_id: z.string().uuid(), title: z.string().min(1), position: Position }),
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

const MoveEndpoint = z.object({ list_id: z.string().uuid(), position: Position })
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
])
export type AnyEvent = z.infer<typeof AnyEvent>

export type EventOfType<T extends EventType> = z.infer<(typeof EVENT_SCHEMAS)[T]>
