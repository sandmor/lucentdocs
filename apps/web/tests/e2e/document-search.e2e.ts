import { expect, test } from '@playwright/test'
import { createProject } from './helpers/inline-ai'

test('semantic search opens a matching snippet with the correct editor selection', async ({
  page,
}) => {
  await createProject(page, 'Semantic Search Selection')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  const content = [
    ...Array.from(
      { length: 24 },
      (_, index) => `Filler paragraph ${index} before the semantic hit.`
    ),
    'The cedar comet sings softly above the harbor at midnight.',
    ...Array.from(
      { length: 10 },
      (_, index) => `Trailing paragraph ${index} after the semantic hit.`
    ),
  ].join('\n\n')
  await page.keyboard.insertText(content)

  await page.waitForTimeout(1500)

  const searchInput = page.locator('[data-document-search="true"]')
  await searchInput.fill('cedar comet midnight')

  await expect
    .poll(async () => page.locator('[data-search-result-card]').count(), { timeout: 15_000 })
    .toBe(1)

  await page.locator('[data-search-result-snippet]').first().click()

  await expect(page).toHaveURL(/from=\d+.*to=\d+/)
  await expect
    .poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? ''), {
      timeout: 5_000,
    })
    .toContain('cedar comet')
  await expect
    .poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? ''), {
      timeout: 5_000,
    })
    .toContain('midnight')
})
