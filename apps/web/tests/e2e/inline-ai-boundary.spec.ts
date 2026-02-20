import { expect, test } from '@playwright/test'
import {
  createProject,
  editorText,
  normalizeWhitespace,
  placeCaretAtDocumentBoundary,
  placeCaretAtZoneBoundary,
  placeCaretInsideZone,
  placeCaretInsideZoneMiddle,
  startInlineGeneration,
} from './helpers/inline-ai'

test('bubble highlight and reject flow stay stable', async ({ page }) => {
  await page.route('**/api/ai/stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: ' [AI suggestion] ',
    })
  })

  await createProject(page, 'E2E Inline AI')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('Prelude')

  await startInlineGeneration(page)
  await expect(page.locator('.ai-writer-floating-controls')).toBeVisible()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await placeCaretInsideZone(page, 'start')
    await page.keyboard.type('X')

    await placeCaretInsideZone(page, 'end')
    await page.keyboard.type('Y')
  }

  const bubbleText = (await page.locator('.ai-generating-text').innerText()).trim()
  expect(bubbleText.includes('X')).toBeFalsy()
  expect(bubbleText.includes('Y')).toBeFalsy()

  await page.locator('.ai-writer-floating-controls [data-action="reject"]').click()
  await expect(page.locator('.ai-generating-text')).toHaveCount(0)
})

test('typing at boundaries works while inside stays blocked and editor never locks', async ({
  page,
}) => {
  await page.route('**/api/ai/stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: 'cat',
    })
  })

  await createProject(page, 'E2E Boundaries')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('Tommy is a ')

  await startInlineGeneration(page)

  await placeCaretAtZoneBoundary(page, 'before')
  await page.keyboard.type('X')

  await placeCaretAtZoneBoundary(page, 'after')
  await page.keyboard.type('Y')

  expect((await page.locator('.ai-generating-text').innerText()).trim()).toBe('cat')
  expect(normalizeWhitespace(await editorText(page))).toContain('Tommy is a XcatY')

  await placeCaretInsideZoneMiddle(page)
  await page.keyboard.type('Z')
  expect((await page.locator('.ai-generating-text').innerText()).trim()).toBe('cat')

  await placeCaretAtDocumentBoundary(page, 'start')
  await page.keyboard.type('Start: ')
  expect(normalizeWhitespace(await editorText(page))).toContain('Start: Tommy is a XcatY')

  await placeCaretAtDocumentBoundary(page, 'end')
  await page.keyboard.type(' tail')
  expect(normalizeWhitespace(await editorText(page))).toContain('Start: Tommy is a XcatY tail')
})

test('keyboard left-right movement allows immediate boundary typing', async ({ page }) => {
  await page.route('**/api/ai/stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: 'cat',
    })
  })

  await createProject(page, 'E2E Keyboard Boundaries')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('Tommy is a ')

  await startInlineGeneration(page)

  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('B')

  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('A')

  expect((await page.locator('.ai-generating-text').innerText()).trim()).toBe('cat')
  expect(normalizeWhitespace(await editorText(page))).toContain('Tommy is a BcatA')
})
