import { auth } from './config'

/**
 * Every API route resolves the authenticated user id from the session —
 * never from the request body or a header — so there is no code path
 * that lets a client claim to be someone else (docs/DECISIONS.md "Auth
 * isolation", tested in test/integration/sync.test.ts and history/
 * snapshot route tests).
 */
export async function requireUserId(): Promise<string | null> {
  const session = await auth()
  return session?.user?.id ?? null
}
