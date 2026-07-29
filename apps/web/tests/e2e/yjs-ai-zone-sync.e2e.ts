import { expect, test } from '@playwright/test'
import { createProject, startInlineGeneration } from './helpers/inline-ai'

async function placeCaretAtParagraphEnd(page: import('@playwright/test').Page, index: number) {
  await page.evaluate((paragraphIndex) => {
    const paragraph = document.querySelectorAll<HTMLElement>('.ProseMirror p')[paragraphIndex]
    if (!paragraph) throw new Error(`Paragraph ${paragraphIndex} was not found`)

    const selection = window.getSelection()
    if (!selection) throw new Error('Selection API is unavailable')

    const range = document.createRange()
    range.selectNodeContents(paragraph)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    paragraph.closest<HTMLElement>('.ProseMirror')?.focus()
    // Playwright's programmatic range does not reliably emit selectionchange.
    // The editor owns keyboard shortcuts through its ProseMirror selection, so
    // synchronise it before starting each client-side continuation.
    document.dispatchEvent(new Event('selectionchange'))
  }, index)
}

test('ai generation zone syncs and clears on reject across clients', async ({ browser, page }) => {
  await createProject(page, 'Yjs AI Zone Reject Sync')

  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()

  try {
    await secondPage.goto(page.url())

    const editorOne = page.locator('.ProseMirror')
    const editorTwo = secondPage.locator('.ProseMirror')

    await expect(editorOne).toBeVisible()
    await expect(editorTwo).toBeVisible()

    await editorOne.click()
    await page.keyboard.type('Once ')
    await startInlineGeneration(page)

    await expect(secondPage.locator('.ai-generating-text')).toBeVisible()
    await expect(secondPage.locator('.ai-generating-text')).toContainText('spark')
    await expect(secondPage.locator('.ai-generating-text')).toHaveCount(1, { timeout: 5_000 })

    await secondPage.locator('.ai-writer-floating-controls [data-action="reject"]').click()

    await expect(page.locator('.ai-generating-text')).toHaveCount(0)
    await expect(secondPage.locator('.ai-generating-text')).toHaveCount(0)
    await expect(editorTwo).toContainText('Once')
    await expect(editorTwo).not.toContainText('spark')
  } finally {
    await secondContext.close()
  }
})

test('ai generation zone syncs and persists on accept across clients', async ({
  browser,
  page,
}) => {
  await createProject(page, 'Yjs AI Zone Accept Sync')

  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()

  try {
    await secondPage.goto(page.url())

    const editorOne = page.locator('.ProseMirror')
    const editorTwo = secondPage.locator('.ProseMirror')

    await expect(editorOne).toBeVisible()
    await expect(editorTwo).toBeVisible()

    await editorOne.click()
    await page.keyboard.type('Once ')
    await startInlineGeneration(page)

    await expect(secondPage.locator('.ai-generating-text')).toBeVisible()
    await expect(secondPage.locator('.ai-generating-text')).toContainText('spark')

    await secondPage.locator('.ai-writer-floating-controls [data-action="accept"]').click()

    await expect(page.locator('.ai-generating-text')).toHaveCount(0)
    await expect(secondPage.locator('.ai-generating-text')).toHaveCount(0)
    await expect(editorTwo).toContainText('Once spark')
  } finally {
    await secondContext.close()
  }
})

test('concurrent continuation drafts stay visible across clients', async ({ browser, page }) => {
  await createProject(page, 'Yjs Concurrent AI Draft Previews')

  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()

  try {
    const editorOne = page.locator('.ProseMirror')
    await editorOne.click()
    await page.keyboard.type('Alpha')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Beta')

    await secondPage.goto(page.url())
    const editorTwo = secondPage.locator('.ProseMirror')
    await expect(editorTwo).toContainText('Beta')

    await placeCaretAtParagraphEnd(page, 0)
    await placeCaretAtParagraphEnd(secondPage, 1)
    await Promise.all([startInlineGeneration(page), startInlineGeneration(secondPage)])

    const previewOne = page.locator('.ai-zone-draft-preview .ai-generating-text')
    const previewTwo = secondPage.locator('.ai-zone-draft-preview .ai-generating-text')
    await expect(previewOne).toHaveCount(2, { timeout: 10_000 })
    await expect(previewTwo).toHaveCount(2, { timeout: 10_000 })
    await expect(previewOne).toHaveText(['spark', 'spark'])
    await expect(previewTwo).toHaveText(['spark', 'spark'])
  } finally {
    await secondContext.close()
  }
})
