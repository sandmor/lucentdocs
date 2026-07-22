import { expect, test } from '@playwright/test'
import {
  createProject,
  openSelectionAskAI,
  placeCaretAtText,
  placeCaretInsideZoneMiddle,
  selectEditorText,
  startInlineGeneration,
} from './helpers/inline-ai'

async function startPromptRewrite(
  page: import('@playwright/test').Page,
  selectedText: string,
  prompt: string
) {
  const selectionToolbar = page.locator('.ai-selection-toolbar')
  await expect(selectionToolbar).toBeVisible({ timeout: 8_000 })
  await openSelectionAskAI(selectionToolbar)
  const promptInput = selectionToolbar.locator('textarea')
  await expect(promptInput).toBeVisible()
  await promptInput.fill(prompt)
  const submitShortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
  await promptInput.press(submitShortcut)
}

test('block handle stays hidden while a paragraph contains a pending AI zone', async ({ page }) => {
  await createProject(page, 'Yjs AI Zone Block Handle')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('Once ')
  await startInlineGeneration(page)

  await expect(page.locator('.ai-generating-text')).toHaveCount(1, { timeout: 8_000 })
  await expect(page.locator('.ai-writer-floating-controls[data-state="processing"]')).toBeVisible({
    timeout: 8_000,
  })

  const paragraph = editor.locator('p').first()
  const box = await paragraph.boundingBox()
  if (!box) {
    throw new Error('Expected paragraph bounding box for block-handle hover.')
  }

  await page.mouse.move(box.x + 4, box.y + box.height / 2)
  await expect(page.locator('.block-handle')).toHaveCount(0)
})

test('select-all delete does not remove a pending AI zone', async ({ page }) => {
  await createProject(page, 'Yjs AI Zone Block Delete Guard')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('Once ')
  await startInlineGeneration(page)

  await expect(page.locator('.ai-writer-floating-controls[data-state="processing"]')).toHaveCount(
    0,
    {
      timeout: 20_000,
    }
  )
  await expect(editor).toContainText(/Once\s*spark/)

  const selectAll = process.platform === 'darwin' ? 'Meta+a' : 'Control+a'
  await page.keyboard.press(selectAll)
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Delete')

  await expect(editor).toContainText(/Once\s*spark/)
  await expect(page.locator('.ai-generating-text')).toHaveCount(1)
})

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
    await startPromptRewrite(page, 'world', 'Rewrite while protected')

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
    await startPromptRewrite(page, 'Start', 'slow rewrite')

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

    await page
      .locator('.ai-writer-floating-controls[data-state="processing"] [data-action="stop"]')
      .click({ force: true })
    await expect(page.locator('.ai-writer-floating-controls[data-state="processing"]')).toHaveCount(
      0
    )
  } finally {
    await secondContext.close().catch(() => {})
  }
})
