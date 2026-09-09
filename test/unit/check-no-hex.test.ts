import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * scripts/check-no-hex.mjs (CLAUDE.md principle 6 / item 5's explicit
 * "add a lint rule that fails the build if one appears"). Runs the real
 * script as a subprocess against a throwaway fixture tree, since its
 * whole job is walking the filesystem — a unit test that imported its
 * internals would just be re-testing readdirSync.
 */
describe('scripts/check-no-hex.mjs', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-no-hex-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function run(cwd: string): { status: number; output: string } {
    const result = spawnSync('node', [join(process.cwd(), 'scripts/check-no-hex.mjs')], { cwd, encoding: 'utf8' })
    return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` }
  }

  it('exits 0 with no source directories present', () => {
    const result = run(dir)
    expect(result.status).toBe(0)
    expect(result.output).toMatch(/no hard-coded hex/i)
  })

  it('fails on a hex colour in a .css file under app/', () => {
    const appDir = join(dir, 'app')
    mkdirSync(appDir)
    writeFileSync(join(appDir, 'globals.css'), '.x { color: #ffffff; }\n')

    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/#ffffff/)
    expect(result.output).toMatch(/globals\.css:1/)
  })

  it('fails on a hex colour in a .tsx file under components/', () => {
    const componentsDir = join(dir, 'components')
    mkdirSync(componentsDir)
    writeFileSync(join(componentsDir, 'Badge.tsx'), "export const Badge = () => <span style={{ color: '#abc' }} />\n")

    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/#abc/)
  })

  it('ignores hex colours inside *.test.ts fixtures', () => {
    const libDir = join(dir, 'lib')
    mkdirSync(libDir)
    writeFileSync(join(libDir, 'palette.test.ts'), "const input = '#3b82f6'\n")

    const result = run(dir)
    expect(result.status).toBe(0)
  })

  it('passes when colours use oklch() instead of hex', () => {
    const appDir = join(dir, 'app')
    mkdirSync(appDir)
    writeFileSync(join(appDir, 'globals.css'), ':root { --background: oklch(0.99 0 0); }\n')

    const result = run(dir)
    expect(result.status).toBe(0)
  })
})
