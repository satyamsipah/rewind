import { chromium, type Browser } from '@playwright/test'
import { expect, signIn, test, uniqueName } from './fixtures'

/**
 * Two browser CONTEXTS = two independent local Dexie stores = two
 * independent DEVICES of the same signed-in user, which is exactly
 * Rewind's real multi-device model. Both go offline, both tag the SAME
 * task concurrently, both reconnect — both tags must survive (the
 * add-biased LwwElementSet merge, docs/DECISIONS.md), regardless of
 * which device happens to sync first.
 */
test.describe('two devices diverge offline and reconcile', () => {
  let browser: Browser

  test.beforeAll(async () => {
    browser = await chromium.launch()
  })
  test.afterAll(async () => {
    await browser.close()
  })

  test('concurrent tags on the same task both survive after both devices sync', async () => {
    const deviceA = await browser.newContext()
    const deviceB = await browser.newContext()
    await signIn(deviceA, 'divergence')
    await signIn(deviceB, 'divergence')
    const pageA = await deviceA.newPage()
    const pageB = await deviceB.newPage()

    const listName = uniqueName('Shared List')
    const taskName = uniqueName('Shared Task')
    // Unique per run, same as the list/task names — a literal tag string
    // like "blocked" would collide with the same tag on a DIFFERENT
    // task from an earlier run (the event log is append-only, so old
    // runs' data is always still there under this shared test user).
    const tagUrgent = uniqueName('urgent')
    const tagBlocked = uniqueName('blocked')

    // Device A creates the shared list + task while online, then both
    // devices load it (the common ancestor both will diverge from).
    await pageA.goto('/')
    pageA.once('dialog', (d) => d.accept(listName))
    await pageA.getByRole('button', { name: 'New list' }).click()
    await pageA.getByRole('button', { name: listName }).click()
    await pageA.getByLabel('New task title').fill(taskName)
    await pageA.getByLabel('New task title').press('Enter')
    await expect(pageA.getByTestId('sync-status')).toHaveText(/Synced/, { timeout: 15_000 })

    await pageB.goto('/')
    await expect(pageB.getByText(taskName)).toBeVisible({ timeout: 15_000 })
    await expect(pageB.getByTestId('sync-status')).toHaveText(/Synced/, { timeout: 15_000 })

    // Now diverge: both go offline and tag the SAME task independently,
    // each unaware of the other's edit.
    await deviceA.setOffline(true)
    await deviceB.setOffline(true)

    await pageA.getByText(taskName).click()
    await pageA.getByPlaceholder('Add tag…').fill(tagUrgent)
    await pageA.getByPlaceholder('Add tag…').press('Enter')
    await expect(pageA.getByText(`#${tagUrgent}`, { exact: true })).toBeVisible()

    await pageB.getByText(taskName).click()
    await pageB.getByPlaceholder('Add tag…').fill(tagBlocked)
    await pageB.getByPlaceholder('Add tag…').press('Enter')
    await expect(pageB.getByText(`#${tagBlocked}`, { exact: true })).toBeVisible()

    // Reconnect both — order doesn't matter to the merge rule, but
    // exercising both orders is what the domain-level divergence tests
    // already do exhaustively; here we just need ONE real round trip.
    await deviceA.setOffline(false)
    await expect(pageA.getByTestId('sync-status')).toHaveText(/Synced/, { timeout: 15_000 })
    await deviceB.setOffline(false)
    await expect(pageB.getByTestId('sync-status')).toHaveText(/Synced/, { timeout: 15_000 })

    // Device A pulls B's tag too (give the SSE nudge / fallback poll a
    // moment, then reload to force a fresh pull if needed).
    await pageA.reload()
    await pageA.getByText(taskName).click()
    await expect(pageA.getByText(`#${tagUrgent}`, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(pageA.getByText(`#${tagBlocked}`, { exact: true })).toBeVisible({ timeout: 15_000 })

    await deviceA.close()
    await deviceB.close()
  })
})
