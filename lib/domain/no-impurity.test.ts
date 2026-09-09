import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Static enforcement of .claude/rules/domain.md: no Date.now(), no
 * Math.random(), no `new Date()` with no arguments, anywhere under
 * lib/domain — the reducer's purity can't depend on hidden ambient state.
 * (lib/events/factory.ts is explicitly the one place client_timestamp is
 * allowed to be stamped from the clock; it is outside this directory.)
 */
const DOMAIN_DIR = join(__dirname)
const FORBIDDEN = [/Date\.now\s*\(/, /Math\.random\s*\(/, /new Date\s*\(\s*\)/]

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return listSourceFiles(full)
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : []
  })
}

/** Strips /* *‍/ and // comments so a docstring that mentions these
 * forbidden calls by name (as this very file's neighbours do, explaining
 * the rule) doesn't trip the check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('lib/domain purity (static check)', () => {
  it('contains no Date.now / Math.random / bare `new Date()`', () => {
    const offenders: string[] = []
    for (const file of listSourceFiles(DOMAIN_DIR)) {
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const pattern of FORBIDDEN) {
        if (pattern.test(code)) offenders.push(`${file}: ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
