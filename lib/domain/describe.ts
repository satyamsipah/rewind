import type { AnyEvent } from '@/lib/events/schemas'

/**
 * Pure `event -> human string`, used by GET /history to render the
 * activity timeline. Kept out of the API route per CLAUDE.md "No business
 * logic in components" (routes are thin; domain logic — including how an
 * event is described — lives in lib/domain).
 */
export function describe(event: AnyEvent): string {
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
    case 'TaskMoved':
      return `moved task to list ${event.payload.to.list_id}`
    case 'TaskDueDateSet':
      return event.payload.to ? `set due date to ${event.payload.to}` : 'cleared due date'
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
  }
}
