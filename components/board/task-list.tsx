'use client'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence } from 'framer-motion'
import type { TaskState } from '@/lib/domain/state'
import { moveTask } from '@/lib/client/mutations'
import { positionBetween } from '@/lib/shared/fractional-index'
import { TaskRow } from './task-row'
import { EmptyState } from '@/components/empty-state'
import { TaskListSkeleton } from '@/components/skeletons'

/**
 * Drag-and-drop reordering (item 3): dropping a task computes ONE new
 * fractional-index position between its new neighbours and calls
 * moveTask once — a single TaskMoved event, never a renumbering pass
 * across every sibling (docs/DECISIONS.md, lib/shared/fractional-index.ts).
 */
export function TaskList({ tasks, loading }: { tasks: TaskState[] | undefined; loading: boolean }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const topLevel = (tasks ?? []).filter((t) => !t.parent_task_id)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = topLevel.findIndex((t) => t.id === active.id)
    const newIndex = topLevel.findIndex((t) => t.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = [...topLevel]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved!)

    const before = reordered[newIndex - 1]?.position ?? null
    const after = reordered[newIndex + 1]?.position ?? null
    const position = positionBetween(before, after)

    moveTask(moved!.id, { listId: moved!.list_id, position, parentTaskId: moved!.parent_task_id })
  }

  if (loading) return <TaskListSkeleton />
  if (topLevel.length === 0) {
    return <EmptyState title="Nothing here yet" description="Press N or use the input above to add your first task." />
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={topLevel.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-0.5">
          <AnimatePresence initial={false}>
            {topLevel.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </AnimatePresence>
        </ul>
      </SortableContext>
    </DndContext>
  )
}
