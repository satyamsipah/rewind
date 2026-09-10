import type { AnyEvent } from '@/lib/events/schemas'

/**
 * Extra data `describe` can't derive from the event alone. An event
 * records the *id* it acted on, never the human name — the name lives in
 * projected state and can change after the fact — so a caller that wants
 * names rendered has to supply the current ones.
 */
export interface DescribeContext {
  /** list id -> current list name. Absent entries degrade to a generic
   * phrase rather than leaking an id into the sentence. */
  listNames?: Record<string, string>
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Reads the calendar date straight out of the ISO string instead of
 * going through `Date`/`toLocaleDateString`. Two reasons, both load-bearing:
 *
 * 1. `describe` runs server-side (GET /history) and in the browser
 *    (lib/client/history.ts), so a locale- or timezone-sensitive format
 *    would render the same event differently depending on the path.
 * 2. A due date is a calendar date, and the one the person picked is
 *    already written in the string. Normalising to UTC would shift it a
 *    day for anyone whose offset isn't Z — `2026-09-10T00:00:00+05:30`
 *    is "10 Sep" to its author and "9 Sep" only to a UTC observer.
 *
 * (lib/domain is `Date`-free by rule — .claude/rules/domain.md — which
 * points the same direction.)
 */
function formatDate(iso: string): string {
  const day = Number(iso.slice(8, 10))
  const month = MONTHS[Number(iso.slice(5, 7)) - 1]!
  return `${day} ${month} ${iso.slice(0, 4)}`
}

/**
 * Pure `event -> human string`, used by GET /history to render the
 * activity timeline. Kept out of the API route per CLAUDE.md "No business
 * logic in components" (routes are thin; domain logic — including how an
 * event is described — lives in lib/domain).
 */
export function describe(event: AnyEvent, context: DescribeContext = {}): string {
  switch (event.type) {
    case 'TaskCreated':
      return `created task "${event.payload.title}"`
    case 'TaskRenamed':
      return `renamed task "${event.payload.from}" to "${event.payload.to}"`
    case 'TaskCompleted':
      return 'completed task'
    case 'TaskUncompleted':
      return 'marked task incomplete'
    case 'TaskDeleted':
      return 'deleted task'
    case 'TaskRestored':
      return 'restored task'
    case 'TaskMoved': {
      if (event.payload.to.parent_task_id) return 'moved task under a new parent task'
      const name = context.listNames?.[event.payload.to.list_id]
      return name ? `moved task to list "${name}"` : 'moved task to another list'
    }
    case 'TaskDueDateSet':
      return event.payload.to ? `set due date to ${formatDate(event.payload.to)}` : 'cleared due date'
    case 'TaskPriorityChanged':
      return event.payload.to ? `set priority to ${event.payload.to}` : 'cleared priority'
    case 'TagAdded':
      return `added tag "${event.payload.tag}"`
    case 'TagRemoved':
      return `removed tag "${event.payload.tag}"`
    case 'ListCreated':
      return `created list "${event.payload.name}"`
    case 'ListRenamed':
      return `renamed list "${event.payload.from}" to "${event.payload.to}"`
    case 'ListArchived':
      return event.payload.to ? 'archived list' : 'unarchived list'
    case 'NoteAttached':
      return event.payload.to ? 'attached a note' : 'removed the note'
    case 'PreferenceSet':
      return `changed ${event.payload.key.replace('_', ' ')}`
  }
}
