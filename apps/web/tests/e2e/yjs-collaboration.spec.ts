import { expect, test } from '@playwright/test'
import { createProject } from './helpers/inline-ai'

test('yjs syncs edits from one client to another on same document', async ({ browser, page }) => {
  await createProject(page, 'Yjs Collaboration')

  const url = page.url()
  const contextTwo = await browser.newContext()
  const pageTwo = await contextTwo.newPage()

  try {
    await pageTwo.goto(url)

    const editorOne = page.locator('.ProseMirror')
    const editorTwo = pageTwo.locator('.ProseMirror')

    await expect(editorOne).toBeVisible()
    await expect(editorTwo).toBeVisible()

    await editorOne.click()
    await page.keyboard.press('End')
    await page.keyboard.type('Hello from client one')

    await expect(editorTwo).toContainText('Hello from client one')
  } finally {
    await contextTwo.close()
  }
})
