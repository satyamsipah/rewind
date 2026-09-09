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
  callbacks: {
    session({ session, user }) {
      if (session.user) session.user.id = user.id
      return session
    },
  },
})
