import { expect, test } from '@playwright/test'
import { createProject, startInlineGeneration } from './helpers/inline-ai'

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
