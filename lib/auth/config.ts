import { DrizzleAdapter } from '@auth/drizzle-adapter'
import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import { getDb } from '@/lib/db/client'
import { accounts, sessions, users, verificationTokens } from '@/lib/db/schema'

/**
 * Auth.js v5 with GitHub OAuth and database sessions (CLAUDE.md tech
 * stack). Database sessions (not JWT) so a session can be revoked
 * server-side and so `session.user.id` is always the real users.id row —
 * every event's actor_id and every query's user_id scope come from this,
 * never from a client-supplied value (docs/DECISIONS.md "Auth
 * isolation").
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  providers: [GitHub],
  // Without AUTH_URL set, Auth.js v5 rejects requests whose Host header
  // it can't statically verify ("UntrustedHost") — this surfaced
  // running a local production build for e2e tests, but the same gap
  // would hit a real deployment on a custom domain Vercel didn't
  // auto-configure AUTH_URL for. trustHost defers that check to the
  // platform/reverse-proxy instead, which is the standard fix Auth.js's
  // own docs recommend for exactly this case.
  trustHost: true,
  callbacks: {
    session({ session, user }) {
      if (session.user) session.user.id = user.id
      return session
    },
  },
})
