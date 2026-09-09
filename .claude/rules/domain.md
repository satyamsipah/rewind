---
paths:
  - "lib/domain/**/*.ts"
  - "lib/events/**/*.ts"
---

# Domain rules

- Events are immutable. Never mutate an event object after creation.
- The reducer (events -> state) must be a pure function: same events in,
  same state out, every time. No Date.now(), no randomness, no I/O.
- Every new event type needs: a Zod schema, a reducer case, an inverse for
  undo, and a test asserting apply-then-inverse returns the original state.
- Vector clock comparison logic lives in one place and is unit tested
  against concurrent, causal, and identical cases.
