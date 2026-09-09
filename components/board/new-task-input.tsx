'use client'

import { useEffect, useRef, useState } from 'react'
import { createTask } from '@/lib/client/mutations'
import { useTasksForList } from '@/lib/client/hooks'
import { positionsAppending } from '@/lib/shared/fractional-index'
import { useUiStore } from '@/lib/client/ui-store'
import { Input } from '@/components/ui/input'

export function NewTaskInput({ listId }: { listId: string | null }) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const tasks = useTasksForList(listId)
  const newTaskRequestId = useUiStore((s) => s.newTaskRequestId)

  useEffect(() => {
    if (newTaskRequestId > 0) inputRef.current?.focus()
  }, [newTaskRequestId])

  async function submit() {
    const trimmed = title.trim()
    if (!trimmed || !listId) return
    const [position] = positionsAppending(1, tasks?.at(-1)?.position ?? null)
    await createTask({ listId, title: trimmed, position: position! })
    setTitle('')
  }

  return (
    <Input
      ref={inputRef}
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && submit()}
      disabled={!listId}
      placeholder={listId ? 'Add a task and press Enter…' : 'Select a list to add tasks'}
      aria-label="New task title"
    />
  )
}
