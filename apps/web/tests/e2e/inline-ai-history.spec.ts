import { expect, test } from '@playwright/test'
import {
  createProject,
  editorText,
  normalizeWhitespace,
  startInlineGeneration,
} from './helpers/inline-ai'

test('selection overlap is blocked and history remains stable over accept/reject cycles', async ({
  page,
}) => {
  const streamChunks = ['cat', 'dog', 'fox']
  let streamIndex = 0

  await page.route('**/api/ai/stream', async (route) => {
    const body = streamChunks[Math.min(streamIndex, streamChunks.length - 1)]
    streamIndex += 1

    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body,
    })
  })

  await createProject(page, 'E2E History')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('Tommy is a ')

  await startInlineGeneration(page)
  await page.keyboard.press('Tab')
  await expect(page.locator('.ai-generating-text')).toHaveCount(0)

  await page.keyboard.type(' and ')
  await startInlineGeneration(page)

  await page.evaluate(() => {
    const zone = document.querySelector('.ai-generating-text')
    if (!zone || !zone.parentNode) return

    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()
    range.setStartBefore(zone)
    range.setEndAfter(zone)
    selection.removeAllRanges()
    selection.addRange(range)
  })

  await page.keyboard.type('Q')
  expect((await page.locator('.ai-generating-text').innerText()).trim()).toBe('dog')

  await page.keyboard.press('Escape')
  await expect(page.locator('.ai-generating-text')).toHaveCount(0)

  await page.keyboard.type(' plays')

  await startInlineGeneration(page)
  await page.locator('.ai-writer-floating-controls [data-action="accept"]').click()
  await expect(page.locator('.ai-generating-text')).toHaveCount(0)

  expect(normalizeWhitespace(await editorText(page))).toContain('Tommy is a cat and playsfox')

  const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z'
  const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z'

  await page.keyboard.press(undoKey)
  await page.keyboard.press(undoKey)
  await page.keyboard.press(redoKey)

  await editor.click()
  await page.keyboard.type('!')
  expect(normalizeWhitespace(await editorText(page))).toContain('!')
})
