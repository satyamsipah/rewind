import { defineConfig } from 'drizzle-kit'

// Reads DATABASE_URL from the environment. Hand-written SQL migrations (the
// append-only trigger) live alongside generated ones in ./drizzle — see
// drizzle/0000_append_only_trigger.sql.
export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/rewind',
  },
  strict: true,
  verbose: true,
})
