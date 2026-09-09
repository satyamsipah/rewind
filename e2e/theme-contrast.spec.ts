import AxeBuilder from '@axe-core/playwright'
import { expect, signIn, test } from './fixtures'

/**
 * Item 9: assert every built-in theme passes WCAG AA. lib/theme/
 * palette.test.ts already proves the DERIVATION math is AA-compliant;
 * this proves the ACTUALLY RENDERED page is too — catching, e.g., a
 * component that used a hard-coded class instead of a token and
 * accidentally escaped the token system.
 */
const ACCENTS = ['Default', 'Violet', 'Amber']
const MODES = ['light', 'dark'] as const

test.describe('theme contrast (WCAG AA)', () => {
  for (const mode of MODES) {
    for (const accent of ACCENTS) {
      test(`${mode} + ${accent} accent has zero color-contrast violations`, async ({ page, context }) => {
        await signIn(context, 'themeContrast')
        await page.goto('/')

        await page.getByRole('button', { name: 'Theme' }).click()
        await page.getByRole('button', { name: mode, exact: true }).click()
        await page.getByRole('button', { name: accent, exact: true }).click()

        // Confirm the theme actually applied before scanning, rather
        // than assuming the click's effect is synchronous with the next
        // line — this data-theme attribute flip is what every token in
        // app/globals.css keys off.
        await page.waitForFunction((m) => document.documentElement.getAttribute('data-theme') === m, mode)

        await page.keyboard.press('Escape')
        // Let the dialog's own close transition (150ms) finish so axe
        // never scans a mid-fade frame with a transiently-blended colour.
        await page.waitForTimeout(300)

        const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
        expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
      })
    }
  }
})
