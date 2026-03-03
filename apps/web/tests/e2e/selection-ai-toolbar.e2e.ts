import { expect, test } from '@playwright/test'
import { createProject, selectEditorText, startInlineGeneration } from './helpers/inline-ai'

test('selection toolbar sends prompt and keeps editor unchanged without tool write actions', async ({
  page,
}) => {
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
  await expect(page.locator('.ai-writer-floating-controls[data-state="review"]')).toBeVisible()
  await page.locator('.ai-writer-floating-controls [data-action="accept"]').first().click()

  await expect(editor).toContainText('Hello world')
})

test('undo after selection rewrite request restores original paragraph text', async ({ page }) => {
  await createProject(page, 'Selection Undo Zone Creation')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('the house is blue')
  await selectEditorText(page, 'house')

  const selectionToolbar = page.locator('.ai-selection-toolbar')
  await expect(selectionToolbar).toBeVisible()

  const promptInput = selectionToolbar.locator('textarea')
  await promptInput.fill('Rewrite this')
  const submitShortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
  await promptInput.press(submitShortcut)

  await expect(page.locator('.ai-writer-floating-controls[data-state="processing"]')).toBeVisible()

  const undoShortcut = process.platform === 'darwin' ? 'Meta+z' : 'Control+z'
  await editor.click()
  await page.keyboard.press(undoShortcut)

  await expect(page.locator('.ai-generating-text')).toHaveCount(0)
  await expect(page.locator('.ai-writer-floating-controls')).toHaveCount(0)
  await expect(page.locator('.ProseMirror p')).toHaveCount(1)
  await expect(editor).toContainText('the house is blue')
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
