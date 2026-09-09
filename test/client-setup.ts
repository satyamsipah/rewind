// Polyfills IndexedDB for Dexie under jsdom/Vitest — see vitest.workspace.ts
// "client" project. Must be imported before any module that touches
// `lib/client/db.ts` (Dexie opens the DB at module scope).
import 'fake-indexeddb/auto'
