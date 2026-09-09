'use client'

import * as Tabs from '@radix-ui/react-tabs'
import { useState } from 'react'
import { EVENT_TYPES } from '@/lib/events/schemas'
import { useActivityTimeline, useTaskHistory } from '@/lib/client/history'
import { useUiStore } from '@/lib/client/ui-store'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { TimeTravelView } from './time-travel-view'

function EventRow({ description, timestamp }: { description: string; timestamp: string }) {
  return (
    <li className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
      <span className="text-foreground">{description}</span>
      <time className="shrink-0 text-xs text-muted-foreground" dateTime={timestamp}>
        {new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </time>
    </li>
  )
}

function Timeline() {
  const [typeFilter, setTypeFilter] = useState('')
  const items = useActivityTimeline(typeFilter ? { type: typeFilter } : {})

  return (
    <div className="flex flex-col gap-3">
      <select
        value={typeFilter}
        onChange={(e) => setTypeFilter(e.target.value)}
        className="w-fit rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        aria-label="Filter by event type"
      >
        <option value="">All event types</option>
        {EVENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <ul className="max-h-96 overflow-y-auto">
        {(items ?? []).map(({ event, description }) => (
          <EventRow key={event.id} description={description} timestamp={event.server_timestamp ?? event.client_timestamp} />
        ))}
        {items && items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>}
      </ul>
    </div>
  )
}

function TaskHistoryTab({ taskId }: { taskId: string }) {
  const items = useTaskHistory(taskId)
  return (
    <ul className="max-h-96 overflow-y-auto">
      {(items ?? []).map(({ event, description }) => (
        <EventRow key={event.id} description={description} timestamp={event.server_timestamp ?? event.client_timestamp} />
      ))}
    </ul>
  )
}

/** Item 4, "the differentiating feature": activity timeline, per-task
 * history, and the time-travel view, as tabs of one panel. */
export function HistoryPanel() {
  const open = useUiStore((s) => s.historyOpen)
  const setOpen = useUiStore((s) => s.setHistoryOpen)
  const historyTaskId = useUiStore((s) => s.historyTaskId)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>History</DialogTitle>
        <Tabs.Root defaultValue={historyTaskId ? 'task' : 'timeline'} className="mt-2">
          <Tabs.List className="mb-4 flex gap-1 border-b border-border">
            <Tabs.Trigger value="timeline" className="px-3 py-2 text-sm text-muted-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-foreground">
              Activity timeline
            </Tabs.Trigger>
            {historyTaskId && (
              <Tabs.Trigger value="task" className="px-3 py-2 text-sm text-muted-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-foreground">
                This task
              </Tabs.Trigger>
            )}
            <Tabs.Trigger value="time-travel" className="px-3 py-2 text-sm text-muted-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-foreground">
              Time travel
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="timeline">
            <Timeline />
          </Tabs.Content>
          {historyTaskId && (
            <Tabs.Content value="task">
              <TaskHistoryTab taskId={historyTaskId} />
            </Tabs.Content>
          )}
          <Tabs.Content value="time-travel">
            <TimeTravelView />
          </Tabs.Content>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  )
}
