import { expect, test } from '@playwright/test'
import {
  createProject,
  placeCaretAtText,
  placeCaretInsideZoneMiddle,
  selectEditorText,
} from './helpers/inline-ai'

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

test('local caret stays outside the zone across remote updates while AI is processing', async ({
  browser,
  page,
}) => {
  await createProject(page, 'Yjs AI Zone Caret Stability')

  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()

  try {
    await secondPage.goto(page.url())

    const editorOne = page.locator('.ProseMirror')
    const editorTwo = secondPage.locator('.ProseMirror')

    await expect(editorOne).toBeVisible()
    await expect(editorTwo).toBeVisible()

    await editorOne.click()
    await page.keyboard.type('Start line')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Tail line')

    await selectEditorText(page, 'Start')

    const selectionToolbar = page.locator('.ai-selection-toolbar')
    await expect(selectionToolbar).toBeVisible({ timeout: 8_000 })
    await selectionToolbar.locator('textarea').fill('slow rewrite')
    await selectionToolbar.getByRole('button', { name: 'Rewrite' }).click()

    await expect(page.locator('.ai-writer-floating-controls[data-state="processing"]')).toBeVisible(
      {
        timeout: 8_000,
      }
    )

    await editorOne.click()
    await placeCaretAtText(page, 'Tail line')
    await page.keyboard.type(' local')
    await expect(editorOne).toContainText('Tail line local')

    await editorTwo.click()
    await placeCaretAtText(secondPage, 'Tail line local')
    await secondPage.keyboard.type(' peer')
    await expect(editorOne).toContainText('Tail line local peer', { timeout: 12_000 })

    await page.bringToFront()
    await placeCaretAtText(page, 'Tail line local peer')
    await page.keyboard.type(' edit')

    await expect(editorOne).toContainText('Tail line local peer edit')
    await expect(editorOne).not.toContainText('Start edit')
  } finally {
    await secondContext.close().catch(() => {})
  }
})
