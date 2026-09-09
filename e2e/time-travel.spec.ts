import { expect, signIn, test, uniqueName } from './fixtures'

/** Item 4: the time-travel view rendered at a past instant must match
 * the expected state — specifically, a task created AFTER that instant
 * must not appear, and the same task must appear once travelled forward
 * past its creation. */
test.describe('time travel', () => {
  test('a past instant excludes a not-yet-created task; the present includes it', async ({ page, context }) => {
    await signIn(context, 'timeTravel')
    const listName = uniqueName('TT List')
    const taskName = uniqueName('TT Task')

    await page.goto('/')
    const before = new Date()

    page.once('dialog', (d) => d.accept(listName))
    await page.getByRole('button', { name: 'New list' }).click()
    await page.getByRole('button', { name: listName }).click()
    await page.getByLabel('New task title').fill(taskName)
    await page.getByLabel('New task title').press('Enter')
    await expect(page.getByText(taskName)).toBeVisible()

    await page.getByRole('button', { name: 'Open activity history' }).click()
    await page.getByRole('tab', { name: 'Time travel' }).click()

    const datetimeInput = page.locator('input[type="datetime-local"]')

    // "Nothing existed yet" is the read-only time-travel PANEL's own
    // empty state — the live board underneath (a separate view, still
    // showing the task) is deliberately not asserted on here, since this
    // dialog overlays it rather than replacing it.
    await datetimeInput.fill(toLocalInputValue(before))
    await page.getByRole('button', { name: 'View' }).click()
    await expect(page.getByText('Nothing existed yet at this instant.')).toBeVisible()

    // `<input type="datetime-local">` only has MINUTE resolution — a
    // plain `new Date()` here could floor to the same minute the task
    // was created in, landing the query's cutoff a few seconds BEFORE
    // the task's actual timestamp. A few minutes in the future avoids
    // that ambiguity without depending on real wall-clock delay.
    const wellAfter = new Date(Date.now() + 5 * 60_000)
    await datetimeInput.fill(toLocalInputValue(wellAfter))
    await page.getByRole('button', { name: 'View' }).click()
    await expect(page.getByText('Nothing existed yet at this instant.')).not.toBeVisible()
    await expect(page.getByRole('dialog').getByText(taskName)).toBeVisible()
  })
})

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
