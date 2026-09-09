import { AppShell } from '@/components/app-shell'

/** Static shell — see components/app-shell.tsx for why the auth decision
 * is made client-side rather than by gating this Server Component on
 * `auth()` (PWA offline requirements, item 7). */
export default function HomePage() {
  return <AppShell />
}
