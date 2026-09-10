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

  /**
   * The service worker's whole reason to exist (public/sw.js): the app
   * must LOAD with the network fully off, not merely keep working after
   * a successful load. Guards the network-first document strategy — if
   * its offline fallback to the cached shell regresses, a cold launch
   * goes blank and only a test like this notices.
   */
  test('cold launch with the network fully off still renders the app', async ({ page, context }) => {
    await signIn(context, 'offline')

    // First load registers the worker; the second runs with it already
    // in control, which is when the shell and its content-hashed chunks
    // actually get cached (nothing is cached for a page the worker
    // wasn't controlling yet).
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await expect(page.getByTestId('sync-status')).toBeVisible()
    await page.evaluate(() => navigator.serviceWorker.ready)

    await context.setOffline(true)
    const response = await page.reload()

    // Served from cache, not the network — a browser error page would
    // not be a 200, and the title comes from the cached document.
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle('Rewind')

    // This copy is client-rendered (the SSR'd body is an empty shell), so
    // seeing it proves the cached JS and CSS booted React too, not just
    // that the document came back.
    //
    // It's the SIGNED-OUT landing copy even for a user with a live
    // session: /api/* is deliberately never cached (see public/sw.js), so
    // Auth.js's session check fails offline and the client treats the
    // user as signed out. That's a known gap in the offline story rather
    // than something this test is asserting is correct — see
    // docs/DECISIONS.md "Offline cold launch shows the signed-out shell".
    await expect(page.getByText(/saved locally first/)).toBeVisible()
  })
})
