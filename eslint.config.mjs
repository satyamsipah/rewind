import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Flat ESLint config. Full `eslint-config-next` integration arrives with
 * the UI phase (docs/DECISIONS.md) — there are no components/pages yet,
 * so this stays scoped to TypeScript correctness plus the one
 * project-specific rule .claude/rules/domain.md requires: lib/domain must
 * never read the ambient clock or randomness.
 */
export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'dist/**', 'drizzle/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['lib/domain/**/*.ts'],
    ignores: ['lib/domain/**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', 'Date'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'lib/domain must be pure — no randomness (.claude/rules/domain.md).' },
      ],
    },
  },
)
