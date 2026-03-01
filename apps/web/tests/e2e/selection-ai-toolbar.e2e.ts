import { expect, test, type BrowserContext } from '@playwright/test'
import { createProject, selectEditorText, startInlineGeneration } from './helpers/inline-ai'

async function mockAiStream(context: BrowserContext) {
  await context.route('**/api/ai/stream', async (route) => {
    const payload = route.request().postDataJSON() as { mode?: string } | null

    if (payload?.mode === 'continue') {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: 'spark',
      })
      return
    }

    const events = [
      { type: 'start', messageId: 'msg-1' },
      { type: 'text-start', id: 'txt-1' },
      { type: 'text-delta', id: 'txt-1', delta: 'galaxy' },
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

test('selection toolbar sends prompt and creates a replace AI zone', async ({ page }) => {
  await mockAiStream(page.context())
  await createProject(page, 'Selection Toolbar Prompt')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('Hello world')
  await selectEditorText(page, 'world')

  const selectionToolbar = page.locator('.ai-selection-toolbar')
  await expect(selectionToolbar).toBeVisible()
  await expect(page.locator('.ai-selection-overlay')).toHaveCount(0)

  const promptInput = selectionToolbar.locator('textarea')
  await promptInput.fill('Make this more cosmic')
  await expect(page.locator('.ai-selection-overlay').first()).toBeVisible()
  await expect(selectionToolbar).toHaveAttribute('data-state', 'compose')

  const submitShortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
  await promptInput.press(submitShortcut)

  await expect(page.locator('.ai-writer-floating-controls')).toBeVisible()

  await expect(page.locator('.ai-generating-text')).toContainText('galaxy')
  await expect(page.locator('.ai-writer-floating-controls[data-state="review"]')).toBeVisible()
  await page.locator('.ai-writer-floating-controls [data-action="accept"]').first().click()

  await expect(editor).toContainText('Hello galaxy')
})

test('selection controls toggle bold and italic marks', async ({ page }) => {
  await createProject(page, 'Selection Formatting Controls')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('format me')
  await selectEditorText(page, 'format me')

  const selectionToolbar = page.locator('.ai-selection-toolbar')
  await expect(selectionToolbar).toBeVisible()

  await selectionToolbar.locator('[data-action="format-bold"]').click()
  await selectionToolbar.locator('[data-action="format-italic"]').click()

  await expect(page.locator('.ProseMirror strong').first()).toHaveText('format me')
  await expect(page.locator('.ProseMirror em').first()).toHaveText('format me')
})

test('selection toolbar is replaced by zone controls while AI zone is active', async ({ page }) => {
  await mockAiStream(page.context())
  await createProject(page, 'Selection Toolbar Collision Avoidance')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('Before ')
  await startInlineGeneration(page)

  await expect(page.locator('.ai-writer-floating-controls')).toBeVisible()

  await selectEditorText(page, 'Before')
  const selectionToolbar = page.locator('.ai-selection-toolbar')
  const zoneControls = page.locator('.ai-writer-floating-controls').first()

  await expect(selectionToolbar).toHaveCount(0)
  await expect(zoneControls).toBeVisible()
})
