import { expect, test } from '@playwright/test'
import { createProject, placeCaretInsideZoneMiddle, selectEditorText } from './helpers/inline-ai'

test('remote client cannot edit inside active AI zone', async ({ browser, page }) => {
  await createProject(page, 'Yjs AI Zone Protection')

  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()

  try {
    await secondPage.goto(page.url())

    const editorOne = page.locator('.ProseMirror')
    const editorTwo = secondPage.locator('.ProseMirror')

    await expect(editorOne).toBeVisible()
    await expect(editorTwo).toBeVisible()

    await editorOne.click()
    await page.keyboard.type('Once world')
    await selectEditorText(page, 'world')

    const selectionToolbar = page.locator('.ai-selection-toolbar')
    await expect(selectionToolbar).toBeVisible({ timeout: 8_000 })
    await selectionToolbar.locator('textarea').fill('Rewrite while protected')
    await selectionToolbar.getByRole('button', { name: 'Rewrite' }).click()

    await expect(
      secondPage.locator('.ai-writer-floating-controls[data-state="processing"]')
    ).toBeVisible({ timeout: 8_000 })

    await editorTwo.click()
    await placeCaretInsideZoneMiddle(secondPage)
    await secondPage.keyboard.type('X')
    await secondPage.keyboard.press('Backspace')
    await secondPage.keyboard.press('Delete')
    await secondPage.keyboard.press('Enter')

    await expect(editorTwo).toContainText('Once world', { timeout: 12_000 })
    await expect(editorTwo).not.toContainText('Once X')
  } finally {
    await secondContext.close().catch(() => {})
  }
})
