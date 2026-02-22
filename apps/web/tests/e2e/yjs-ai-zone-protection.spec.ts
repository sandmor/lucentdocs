import { expect, test, type BrowserContext } from '@playwright/test'
import {
  createProject,
  placeCaretInsideZoneMiddle,
  startInlineGeneration,
} from './helpers/inline-ai'

async function mockAiStream(context: BrowserContext, responses: string[]) {
  let idx = 0
  await context.route('**/api/ai/stream', async (route) => {
    const body = responses[Math.min(idx, responses.length - 1)]
    idx += 1

    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body,
    })
  })
}

test('remote client cannot edit inside active AI zone', async ({ browser, page }) => {
  await mockAiStream(page.context(), ['spark'])
  await createProject(page, 'Yjs AI Zone Protection')

  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()

  try {
    await mockAiStream(secondContext, ['spark'])
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

    await editorTwo.click()
    await placeCaretInsideZoneMiddle(secondPage)
    await secondPage.keyboard.type('X')
    await secondPage.keyboard.press('Backspace')
    await secondPage.keyboard.press('Delete')
    await secondPage.keyboard.press('Enter')

    await expect(secondPage.locator('.ai-generating-text')).toContainText('spark')
    await expect(editorTwo).toContainText('Once spark')
  } finally {
    await secondContext.close()
  }
})
