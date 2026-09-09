'use client'

import { motion } from 'framer-motion'
import { Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { Priority } from '@/lib/events/schemas'
import type { TaskState } from '@/lib/domain/state'
import {
  addTag,
  createTask,
  removeTag,
  renameTask,
  setTaskDeleted,
  setTaskDueDate,
  setTaskNote,
  setTaskPriority,
} from '@/lib/client/mutations'
import { positionsAppending } from '@/lib/shared/fractional-index'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const PRIORITIES: (Priority | null)[] = [null, 'low', 'medium', 'high']

/** The expanded per-task editor — every field here is a direct call into
 * lib/client/mutations.ts, so there is no "save" step: every keystroke
 * that commits (onBlur / onChange for pickers) writes locally first and
 * queues for sync immediately, per CLAUDE.md principle 3. */
export function TaskDetail({ task }: { task: TaskState }) {
  const [tagInput, setTagInput] = useState('')

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15 }}
      className="mx-2 mb-2 flex flex-col gap-3 rounded-md border border-border bg-background p-3"
    >
      <Input
        defaultValue={task.title}
        onBlur={(e) => e.target.value.trim() && e.target.value !== task.title && renameTask(task.id, e.target.value.trim())}
        aria-label="Task title"
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Due
          <input
            type="date"
            defaultValue={task.due_date?.slice(0, 10) ?? ''}
            onChange={(e) => setTaskDueDate(task.id, e.target.value ? new Date(e.target.value).toISOString() : null)}
            className="rounded-md border border-input bg-background px-2 py-1 text-foreground"
          />
        </label>

        <label className="flex items-center gap-1.5 text-muted-foreground">
          Priority
          <select
            defaultValue={task.priority ?? ''}
            onChange={(e) => setTaskPriority(task.id, (e.target.value || null) as Priority | null)}
            className="rounded-md border border-input bg-background px-2 py-1 text-foreground"
          >
            {PRIORITIES.map((p) => (
              <option key={p ?? 'none'} value={p ?? ''}>
                {p ?? 'None'}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {task.tags.map((tag) => (
          <button
            key={tag}
            onClick={() => removeTag(task.id, tag)}
            className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            title="Remove tag"
          >
            #{tag} ×
          </button>
        ))}
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tagInput.trim()) {
              addTag(task.id, tagInput.trim())
              setTagInput('')
            }
          }}
          placeholder="Add tag…"
          className="w-24 rounded-md border border-dashed border-border bg-transparent px-2 py-0.5 text-xs text-foreground outline-none"
        />
      </div>

      <textarea
        defaultValue={task.note ?? ''}
        onBlur={(e) => setTaskNote(task.id, e.target.value || null)}
        placeholder="Notes…"
        rows={2}
        className="rounded-md border border-input bg-background p-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={async () => {
            const [position] = positionsAppending(1)
            await createTask({ listId: task.list_id, title: 'Subtask', position: position!, parentTaskId: task.id })
          }}
        >
          + Subtask
        </Button>
        {task.deleted ? (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setTaskDeleted(task.id, false)}>
            <Undo2 className="h-3.5 w-3.5" /> Restore
          </Button>
        ) : (
          <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setTaskDeleted(task.id, true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        )}
      </div>
    </motion.div>
  )
}
