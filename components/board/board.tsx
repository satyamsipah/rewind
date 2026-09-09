'use client'

import { useMemo } from 'react'
import { useAllTasks, useLists, useTasksForList } from '@/lib/client/hooks'
import { applyViewFilter, searchTasks } from '@/lib/client/filters'
import { useUiStore } from '@/lib/client/ui-store'
import { Sidebar } from './sidebar'
import { TaskList } from './task-list'
import { NewTaskInput } from './new-task-input'
import { HistoryPanel } from '@/components/history/history-panel'
import { ThemeEditorDialog } from '@/components/theme/theme-editor-dialog'

export function Board() {
  const activeListId = useUiStore((s) => s.activeListId)
  const filter = useUiStore((s) => s.filter)
  const searchQuery = useUiStore((s) => s.searchQuery)
  const lists = useLists()
  const listTasks = useTasksForList(activeListId)
  const allTasks = useAllTasks()

  const rawTasks = activeListId ? listTasks : allTasks
  const loading = rawTasks === undefined
  const tasks = useMemo(() => {
    if (!rawTasks) return undefined
    return searchTasks(applyViewFilter(rawTasks, filter), searchQuery)
  }, [rawTasks, filter, searchQuery])

  const activeList = lists?.find((l) => l.id === activeListId)
  const heading = activeListId ? activeList?.name ?? 'List' : 'All tasks'

  return (
    <div className="flex h-dvh">
      <Sidebar />
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
        <h2 className="text-xl font-semibold text-foreground">{heading}</h2>
        <NewTaskInput listId={activeListId} />
        <TaskList tasks={tasks} loading={loading} />
      </main>
      <HistoryPanel />
      <ThemeEditorDialog />
    </div>
  )
}
