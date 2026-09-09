import { cn } from '@/lib/utils'

/** Item 8: skeleton loading states — shown while Dexie's live query
 * hasn't resolved yet (dexie-react-hooks returns `undefined` until the
 * first read completes). Respects prefers-reduced-motion via the global
 * override in app/globals.css, which zeroes out animation-duration. */
function Bone({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

export function TaskListSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-busy="true" aria-label="Loading tasks">
      {[...Array(5)].map((_, i) => (
        <li key={i} className="flex items-center gap-2 px-2 py-2">
          <Bone className="h-4 w-4 rounded-sm" />
          <Bone className={cn('h-4', i % 2 === 0 ? 'w-1/2' : 'w-1/3')} />
        </li>
      ))}
    </ul>
  )
}

export function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-2" aria-busy="true" aria-label="Loading lists">
      {[...Array(4)].map((_, i) => (
        <Bone key={i} className="h-6 w-full" />
      ))}
    </div>
  )
}
