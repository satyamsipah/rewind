import { test as base, type BrowserContext, type Page } from '@playwright/test'
import { TEST_USERS } from './global-setup'

/**
 * Signs a browser context in via one of the seeded database sessions
 * (global-setup.ts) rather than the real GitHub OAuth flow, which isn't
 * available in CI. Each spec FILE gets its own dedicated test user (not
 * one shared user) — the event log accumulates forever by design, so a
 * shared user's data from an earlier run would still be there when a
 * later spec queries "the board" or "time travel to now". `userKey`
 * defaults to `'offline'` for specs that don't care which user they are,
 * as long as it's consistent within that spec's own test().
 */
export async function signIn(context: BrowserContext, userKey: keyof typeof TEST_USERS = 'offline'): Promise<void> {
  await context.addCookies([
    {
      name: 'authjs.session-token',
      value: TEST_USERS[userKey].token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ context, page }, use) => {
    await signIn(context)
    await use(page)
  },
})

export { expect } from '@playwright/test'
export { TEST_USERS }

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}
