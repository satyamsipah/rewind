---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "e2e/**"
---

# Testing rules

- Every event type has a round-trip test: apply, then inverse, assert
  original state.
- Sync tests simulate two clients diverging offline and reconciling.
- Playwright tests include a genuinely offline scenario using
  context.setOffline(true), not a mocked fetch.
- Idempotency test: replay the same event batch twice, assert identical
  final state.
