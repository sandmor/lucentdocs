import { expect, type Page } from '@playwright/test'

export type PWPage = Page

export async function createProject(page: PWPage, title: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.getByPlaceholder('The Great Novel...').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/project\/[^/]+$/, { timeout: 15_000 })
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 15_000 })
}

export async function startInlineGeneration(page: PWPage) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await expect(page.locator('.ai-generating-text')).toBeVisible({ timeout: 15_000 })
}

export async function placeCaretInsideZoneMiddle(page: PWPage) {
  await page.evaluate(() => {
    const zone = document.querySelector('.ai-generating-text')
    if (!zone) return

    const textNode = zone.firstChild
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return

    const textLength = textNode.textContent?.length ?? 0
    if (textLength < 2) return

    const offset = Math.floor(textLength / 2)
    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()
    range.setStart(textNode, offset)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  })
}
