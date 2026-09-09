import AxeBuilder from '@axe-core/playwright'
import { expect, signIn, test, uniqueName } from './fixtures'

/** Item 9: axe scan on every main view, zero CRITICAL violations. Critical
 * (not "zero violations at any severity") is the bar — axe flags some
 * things (e.g. "best-practice" landscape rules) that are stylistic
 * rather than access-blocking; critical/serious are the ones that
 * actually block a screen-reader or keyboard user. */
function assertNoCritical(violations: { id: string; impact?: string | null }[]) {
  const critical = violations.filter((v) => v.impact === 'critical')
  expect(critical, JSON.stringify(critical, null, 2)).toEqual([])
}

test.describe('accessibility (axe)', () => {
  test('sign-in screen', async ({ page }) => {
    await page.goto('/')
    const results = await new AxeBuilder({ page }).analyze()
    assertNoCritical(results.violations)
  })

  test('board (signed in, empty state)', async ({ page, context }) => {
    await signIn(context, 'accessibilityEmpty')
    await page.goto('/')
    await expect(page.getByText('Nothing here yet')).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    assertNoCritical(results.violations)
  })

  test('command palette open', async ({ page, context }) => {
    await signIn(context, 'accessibility')
    await page.goto('/')
    await page.getByRole('button', { name: 'Search & commands' }).click()
    await expect(page.getByPlaceholder('Type a command or search…')).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    assertNoCritical(results.violations)
  })

  test('history panel open', async ({ page, context }) => {
    await signIn(context, 'accessibility')
    await page.goto('/')
    await page.getByRole('button', { name: 'Open activity history' }).click()
    const results = await new AxeBuilder({ page }).analyze()
    assertNoCritical(results.violations)
  })

  test('theme editor open', async ({ page, context }) => {
    await signIn(context, 'accessibility')
    await page.goto('/')
    await page.getByRole('button', { name: 'Theme' }).click()
    const results = await new AxeBuilder({ page }).analyze()
    assertNoCritical(results.violations)
  })

  test('task detail expanded', async ({ page, context }) => {
    await signIn(context, 'accessibility')
    const listName = uniqueName('A11y List')
    const taskName = uniqueName('A11y Task')
    await page.goto('/')
    page.once('dialog', (d) => d.accept(listName))
    await page.getByRole('button', { name: 'New list' }).click()
    await page.getByRole('button', { name: listName }).click()
    await page.getByLabel('New task title').fill(taskName)
    await page.getByLabel('New task title').press('Enter')
    await page.getByText(taskName).click()

    const results = await new AxeBuilder({ page }).analyze()
    assertNoCritical(results.violations)
  })
})
