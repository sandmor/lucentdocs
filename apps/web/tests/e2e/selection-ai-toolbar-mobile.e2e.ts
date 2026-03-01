import { expect, test, type BrowserContext } from '@playwright/test'
import { createProject, selectEditorText } from './helpers/inline-ai'

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})

async function mockAiStream(context: BrowserContext) {
  await context.route('**/api/ai/stream', async (route) => {
    const events = [
      { type: 'start', messageId: 'msg-1' },
      { type: 'text-start', id: 'txt-1' },
      { type: 'text-delta', id: 'txt-1', delta: 'mobile' },
      { type: 'text-end', id: 'txt-1' },
      { type: 'finish' },
    ]
    const sseBody = [...events.map((event) => JSON.stringify(event)), '[DONE]']
      .map((payload) => `data: ${payload}\n\n`)
      .join('')

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      headers: {
        'x-vercel-ai-ui-message-stream': 'v1',
      },
      body: sseBody,
    })
  })
}

test('mobile uses bottom dock for selection and zone controls', async ({ page }) => {
  await mockAiStream(page.context())
  await createProject(page, 'Selection Toolbar Mobile Dock')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('Hello world')
  await selectEditorText(page, 'world')

  const mobileDock = page.locator('.ai-inline-mobile-dock')
  const selectionToolbar = page.locator('.ai-selection-toolbar')
  await expect(mobileDock).toBeVisible()
  await expect(selectionToolbar).toBeVisible()

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const root = document.documentElement
        return getComputedStyle(root).getPropertyValue('--ai-inline-mobile-dock-reserve').trim()
      })
    })
    .not.toBe('0px')

  await selectionToolbar.locator('textarea').fill('Rewrite for mobile')
  await selectionToolbar.getByRole('button', { name: 'Rewrite' }).click()

  const zoneControls = page.locator('.ai-writer-floating-controls[data-state="review"]')
  await expect(zoneControls).toBeVisible()
  await zoneControls.locator('[data-action="accept"]').click()

  await expect(editor).toContainText('Hello mobile')

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const root = document.documentElement
        return getComputedStyle(root).getPropertyValue('--ai-inline-mobile-dock-reserve').trim()
      })
    })
    .toBe('0px')
})
