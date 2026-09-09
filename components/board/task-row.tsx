'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'framer-motion'
import { ChevronRight, GripVertical } from 'lucide-react'
import { useState } from 'react'
import type { TaskState } from '@/lib/domain/state'
import { setTaskCompleted } from '@/lib/client/mutations'
import { useSubtasks } from '@/lib/client/hooks'
import { useUiStore } from '@/lib/client/ui-store'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { TaskDetail } from './task-detail'

const PRIORITY_TONE: Record<string, string> = {
  high: 'bg-destructive/15 text-destructive',
  medium: 'bg-primary/15 text-primary',
  low: 'bg-muted text-muted-foreground',
}

export function TaskRow({ task, depth = 0 }: { task: TaskState; depth?: number }) {
  const [expanded, setExpanded] = useState(false)
  const subtasks = useSubtasks(task.id)
  const setHistoryTaskId = useUiStore((s) => s.setHistoryTaskId)
  const setHistoryOpen = useUiStore((s) => s.setHistoryOpen)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <motion.li
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15 }}
      className={cn('rounded-md border border-transparent', isDragging && 'opacity-50', depth > 0 && 'ml-6')}
    >
      <div className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent/60">
        {depth === 0 && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <Checkbox checked={task.completed} onCheckedChange={(v) => setTaskCompleted(task.id, v === true)} aria-label={`Mark "${task.title}" complete`} />
        <button
          className={cn('flex-1 truncate text-left text-sm text-foreground', task.completed && 'text-muted-foreground line-through')}
          onClick={() => setExpanded((v) => !v)}
        >
          {task.title}
        </button>
        {task.priority && <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', PRIORITY_TONE[task.priority])}>{task.priority}</span>}
        {task.due_date && (
          <span className="text-xs text-muted-foreground">{new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        )}
        {task.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            #{tag}
          </span>
        ))}
        <button
          onClick={() => {
            setHistoryTaskId(task.id)
            setHistoryOpen(true)
          }}
          className="text-xs text-muted-foreground opacity-0 underline-offset-2 hover:underline group-hover:opacity-100"
        >
          History
        </button>
        <button onClick={() => setExpanded((v) => !v)} aria-label={expanded ? 'Collapse' : 'Expand'} aria-expanded={expanded}>
          <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
        </button>
      </div>

      {expanded && <TaskDetail task={task} />}

      {subtasks && subtasks.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {subtasks.map((sub) => (
            <TaskRow key={sub.id} task={sub} depth={depth + 1} />
          ))}
        </ul>
      )}
    </motion.li>
  )
}
