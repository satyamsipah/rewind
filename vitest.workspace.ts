import path from 'node:path'
import { defineWorkspace } from 'vitest/config'

// Three projects: `unit` runs pure lib/events + lib/domain (+ lib/shared)
// logic with no I/O; `client` runs lib/client's Dexie-backed code under
// jsdom with a fake IndexedDB, since that's genuinely browser-shaped
// code; `integration` boots a real (WASM) Postgres via PGlite so the
// append-only trigger, FOR UPDATE locking, and API routes are exercised
// against the schema as actually shipped.
//
// `resolve.alias` mirrors tsconfig.json's `@/*` path mapping — Vitest
// doesn't read tsconfig paths on its own.
const alias = { '@': path.resolve(__dirname, '.') }

export default defineWorkspace([
  {
    resolve: { alias },
    test: {
      name: 'unit',
      environment: 'node',
      include: ['lib/**/*.test.ts', 'test/unit/**/*.test.ts'],
      exclude: ['lib/client/**/*.test.ts'],
    },
  },
  {
    resolve: { alias },
    test: {
      name: 'client',
      environment: 'jsdom',
      setupFiles: ['./test/client-setup.ts'],
      include: ['lib/client/**/*.test.ts', 'test/client/**/*.test.ts'],
    },
  },
  {
    resolve: { alias },
    test: {
      name: 'integration',
      environment: 'node',
      include: ['test/integration/**/*.test.ts'],
      testTimeout: 20000,
      hookTimeout: 20000,
    },
  },
])
