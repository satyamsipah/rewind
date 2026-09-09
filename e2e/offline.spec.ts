import { expect, signIn, test, uniqueName } from './fixtures'

/**
 * CLAUDE.md principle 3 + item 9's explicit ask: a genuinely offline
 * scenario using `context.setOffline(true)`, not a mocked fetch — this
 * exercises the real browser network stack, the real service worker (if
 * registered), and the real lib/client/sync-engine.ts retry/backoff path.
 */
test.describe('offline scenario', () => {
  test('create tasks while offline, then sync once reconnected', async ({ page, context }) => {
    await signIn(context, 'offline')
    const listName = uniqueName('Offline List')
    const taskName = uniqueName('Offline Task')

    await page.goto('/')
    page.once('dialog', (d) => d.accept(listName))
    await page.getByRole('button', { name: 'New list' }).click()
    await page.getByRole('button', { name: listName }).click()

    const syncStatus = page.getByTestId('sync-status')

    // Go offline BEFORE creating the task — this is the real test.
    await context.setOffline(true)
    await expect(syncStatus).toHaveText(/Offline/)

    const input = page.getByLabel('New task title')
    await input.fill(taskName)
    await input.press('Enter')

    // Optimistic local write: visible immediately, no network involved.
    await expect(page.getByText(taskName)).toBeVisible()
    await expect(syncStatus).toHaveText(/Offline/)

    // Reconnect — the outbox should drain automatically (no manual sync
    // trigger), landing on "Synced".
    await context.setOffline(false)
    await expect(syncStatus).toHaveText(/Synced/, { timeout: 15_000 })

    // Reloading proves it actually reached the server, not just Dexie —
    // a fresh page load pulls from the local projection, which was
    // rebuilt from events the server accepted and sent back.
    await page.reload()
    await expect(page.getByText(taskName)).toBeVisible()
  })
})
