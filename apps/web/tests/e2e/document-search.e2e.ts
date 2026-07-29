import { expect, test } from '@playwright/test'
import { createProject } from './helpers/inline-ai'

test('semantic search opens a short matching snippet with the correct editor selection', async ({
  page,
}) => {
  await createProject(page, 'Semantic Search Selection')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  const content = 'The cedar comet sings softly above the harbor at midnight.'
  await page.keyboard.insertText(content)

  const searchInput = page.locator('[data-document-search="true"]')
  await searchInput.fill('cedar comet midnight')

  // A result card does not imply that this snippet-navigation flow has an
  // actionable result. Wait for the control the test will operate on.
  await expect(page.locator('[data-search-result-snippet]').first()).toBeVisible({
    timeout: 15_000,
  })

  await page.locator('[data-search-result-snippet]').first().click()

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
  await expect(page.locator('[data-editor-search-result-marker]').first()).toBeVisible()
})

test('semantic search opens a long matching snippet at the match start without selecting it', async ({
  page,
}) => {
  await createProject(page, 'Semantic Search Long Snippet')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  const longMatch = [
    'The obsidian lighthouse keeps a quiet ledger of every tide.',
    ...Array.from({ length: 24 }, (_, index) => `Long semantic context ${index} keeps flowing.`),
    'The garnet atlas folds itself beside the rain barrel.',
    ...Array.from({ length: 24 }, (_, index) => `More semantic context ${index} follows.`),
  ].join(' ')
  await page.keyboard.insertText(longMatch)

  const searchInput = page.locator('[data-document-search="true"]')
  await searchInput.fill('garnet atlas rain barrel')

  await expect(page.locator('[data-search-result-snippet]').first()).toBeVisible({
    timeout: 15_000,
  })

  await page.locator('[data-search-result-snippet]').first().click()

  expect(page.url()).not.toMatch(/[?&](from|to)=/)
  await expect
    .poll(
      async () =>
        page.evaluate(() => ({
          collapsed: window.getSelection()?.isCollapsed ?? false,
          text: window.getSelection()?.toString() ?? '',
        })),
      { timeout: 5_000 }
    )
    .toMatchObject({ collapsed: true, text: '' })
  await expect(page.locator('[data-editor-search-result-marker]').first()).toBeVisible()
})
