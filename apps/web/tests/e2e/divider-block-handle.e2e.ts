import { expect, test } from '@playwright/test'
import { createProject } from './helpers/inline-ai'

test('divider exposes the desktop block handle without becoming text-editable', async ({ page }) => {
  await createProject(page, 'Divider handle')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('---')

  const divider = editor.locator('hr')
  await expect(divider).toHaveCount(1)
  const box = await divider.boundingBox()
  if (!box) throw new Error('Expected divider bounds')

  await page.mouse.move(box.x + Math.max(2, box.width / 2), box.y + Math.max(1, box.height / 2))
  await expect(page.locator('.block-handle')).toBeVisible()

  await divider.click()
  await page.keyboard.type('after divider')
  await expect(divider).toHaveCount(1)
  await expect(editor.getByText('after divider', { exact: true })).toBeVisible()
})
