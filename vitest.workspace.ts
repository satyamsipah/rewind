import path from 'node:path'
import { defineWorkspace } from 'vitest/config'

// Two projects, per plan: `unit` runs pure lib/events + lib/domain logic
// with no I/O; `integration` boots a real (WASM) Postgres via PGlite so
// the append-only trigger, FOR UPDATE locking, and API routes are
// exercised against the schema as actually shipped.
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
