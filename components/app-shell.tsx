'use client'

import { useSession } from 'next-auth/react'
import { Board } from '@/components/board/board'
import { SignIn } from '@/components/sign-in'

/**
 * The sign-in/board decision is made CLIENT-SIDE, not by a server-gated
 * page — this is what lets app/page.tsx stay a static, precache-able
 * shell for the PWA service worker (item 7). A Server Component that
 * called auth() per request would make this route fully dynamic, so
 * there would be nothing meaningful for the service worker to serve
 * while genuinely offline (principle 3 applies to the app's OWN shell,
 * not just to task data).
 *
 * `status === 'loading'` briefly shows nothing rather than flashing
 * SignIn before the cached session resolves — next-auth's session cookie
 * check is fast, and Board itself works offline the moment it mounts
 * regardless of whether the network is reachable to revalidate it.
 */
export function AppShell() {
  const { status } = useSession()
  if (status === 'loading') return null
  if (status === 'unauthenticated') return <SignIn />
  return <Board />
}
