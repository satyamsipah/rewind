'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionProvider, useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { setCachedUserId } from '@/lib/client/identity'
import { startSyncEngine } from '@/lib/client/sync-engine'
import { useSyncStatus } from '@/lib/client/hooks'
import { useThemeSync } from '@/lib/client/theme'
import { useRegisterServiceWorker } from '@/lib/client/register-sw'
import { CommandPalette } from '@/components/command-palette'
import { ShortcutSheet } from '@/components/shortcut-sheet'
import { useKeyboardShortcuts } from '@/lib/client/shortcuts'

/**
 * Everything that has to run once, high in the tree, before the rest of
 * the app can assume "identity is known, theme is applied, sync is
 * running": caches the session's user id (lib/client/identity.ts) so
 * mutations can mint events offline even before this resolves again,
 * starts the background sync engine (docs/DECISIONS.md "Client sync
 * architecture"), and applies the persisted theme.
 */
function Bootstrap({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()

  useEffect(() => {
    if (session?.user?.id) setCachedUserId(session.user.id)
  }, [session?.user?.id])

  useEffect(() => startSyncEngine(), [])

  useThemeSync()
  useKeyboardShortcuts()
  useMergeToasts()
  useRegisterServiceWorker()

  return (
    <>
      {children}
      <CommandPalette />
      <ShortcutSheet />
    </>
  )
}

/** Item 2's "conflict" indicator, as designed: informational only, never
 * blocking — a toast when a sync pull actually merged a concurrent
 * remote change, never a dialog demanding a decision (principle 5 means
 * there is never a decision to make). */
function useMergeToasts() {
  const event = useSyncStatus()
  useEffect(() => {
    if (event.merged) {
      toast.info(`Synced ${event.merged.count} change${event.merged.count === 1 ? '' : 's'} from another device`)
    }
    if (event.status === 'signed_out') {
      toast.error('Signed out — sign in again to keep syncing (your changes are saved locally).')
    }
  }, [event])
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <Bootstrap>{children}</Bootstrap>
        <Toaster richColors position="bottom-right" />
      </QueryClientProvider>
    </SessionProvider>
  )
}
