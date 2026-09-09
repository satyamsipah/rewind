#!/usr/bin/env node
/**
 * CLAUDE.md principle 6 / item 5: "No hard-coded hex anywhere — add a
 * lint rule that fails the build if one appears." One script instead of
 * two linters (ESLint can't lint .css; Stylelint can't lint .tsx, and
 * would need an allowlist exception for wherever tokens are actually
 * defined) — since every token value is authored in oklch() function
 * notation (docs/DECISIONS.md "Theme token architecture"), a hex pattern
 * never legitimately appears in shipped source, so this needs zero
 * exceptions/allowlist anywhere, including the token file itself.
 *
 * Test files ARE allowed to contain hex literals: lib/theme/palette.test.ts
 * and contrast.test.ts feed real hex strings in as INPUT (a color picker
 * accepts hex; WCAG reference values are conventionally quoted in hex) —
 * that's testing the math against real-world input, not styling the UI
 * with a hard-coded colour.
 *
 * Usage: node scripts/check-no-hex.mjs (wired into `pnpm lint`)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const SCAN_DIRS = ['app', 'components', 'lib']
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.css'])
const HEX_PATTERN = /#(?:[0-9a-fA-F]{3}){1,2}\b/g

function isTestFile(path) {
  return path.endsWith('.test.ts') || path.endsWith('.test.tsx')
}

function listFiles(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) return listFiles(full)
    if (!SCAN_EXTENSIONS.has(extname(full))) return []
    if (isTestFile(full)) return []
    return [full]
  })
}

function main() {
  const offenders = []
  for (const dir of SCAN_DIRS) {
    for (const file of listFiles(dir)) {
      const contents = readFileSync(file, 'utf8')
      const lines = contents.split('\n')
      lines.forEach((line, i) => {
        const matches = line.match(HEX_PATTERN)
        if (matches) offenders.push(`${file}:${i + 1}: ${matches.join(', ')}`)
      })
    }
  }

  if (offenders.length > 0) {
    console.error('✗ Hard-coded hex colour(s) found (CLAUDE.md principle 6 — use oklch()/hsl() instead):\n')
    for (const line of offenders) console.error(`  ${line}`)
    console.error('')
    // Setting exitCode (not calling process.exit()) lets Node drain
    // stdout/stderr naturally before exiting. Calling process.exit()
    // right after writing output is a well-known Node footgun: when the
    // destination is a pipe rather than a TTY (always true for CI, and
    // for a test harness capturing this script's output), the write can
    // still be in flight and get truncated — or, less predictably, the
    // reported exit status itself can come back wrong to whatever
    // spawned this process.
    process.exitCode = 1
    return
  }

  console.log('✓ No hard-coded hex colours found.')
}

main()
