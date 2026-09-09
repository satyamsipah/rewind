'use client'

import { AlertTriangle, Check, CloudOff, LogIn, RefreshCw } from 'lucide-react'
import { useSyncStatus, useOutboxCount } from '@/lib/client/hooks'
import { triggerSync } from '@/lib/client/sync-engine'
import { cn } from '@/lib/utils'

/**
 * Item 2: "a visible sync status indicator (synced / syncing / offline /
 * conflict)". "Conflict" is deliberately not a state here — every
 * conflict auto-resolves (principle 5); a merge just briefly flashes
 * "synced" with a toast (components/providers/providers.tsx
 * useMergeToasts) rather than needing a dedicated indicator state.
 */
export function SyncStatusBadge() {
  const event = useSyncStatus()
  const pending = useOutboxCount()

  const config = {
    offline: { icon: CloudOff, label: 'Offline', tone: 'text-muted-foreground' },
    syncing: { icon: RefreshCw, label: 'Syncing…', tone: 'text-muted-foreground', spin: true },
    synced: { icon: Check, label: 'Synced', tone: 'text-muted-foreground' },
    error: { icon: AlertTriangle, label: 'Sync error', tone: 'text-destructive' },
    signed_out: { icon: LogIn, label: 'Signed out', tone: 'text-destructive' },
  }[event.status]

  const Icon = config.icon

  return (
    <button
      type="button"
      data-testid="sync-status"
      onClick={() => triggerSync()}
      title={event.lastError ?? config.label}
      className={cn('flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-accent', config.tone)}
    >
      <Icon className={cn('h-3.5 w-3.5', 'spin' in config && config.spin && 'animate-spin')} />
      <span>{config.label}</span>
      {pending > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{pending}</span>}
    </button>
  )
}
