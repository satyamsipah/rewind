import { defineConfig, devices } from '@playwright/test'

/**
 * E2E tests need the real HTTP + browser stack, which PGlite (used by
 * the Vitest integration project) can't provide — these run against a
 * genuinely reachable Postgres via DATABASE_URL, same as any other
 * Next.js e2e setup. `webServer` starts the dev server itself; a
 * developer/CI just needs DATABASE_URL pointing at a real (migrated)
 * Postgres before running `pnpm test:e2e`.
 *
 * There's no real GitHub OAuth in CI, so authentication is a direct
 * database-session seed (e2e/global-setup.ts) rather than driving the
 * actual GitHub sign-in flow — e2e/fixtures.ts injects the resulting
 * session cookie into each test's browser context.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Fully sequential across files too, not just within one — these tests
  // share one dev server and one Postgres instance, and running them
  // concurrently in this environment produces spurious failures purely
  // from resource contention, not real app bugs.
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Production build, not `next dev`: dev mode's Fast Refresh can
    // full-reload the page out from under a test if any source file
    // changes while the suite runs, and its per-session asset URLs make
    // the service worker's cache unreliable too (docs/DECISIONS.md).
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
