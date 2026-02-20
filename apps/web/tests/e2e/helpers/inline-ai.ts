import { expect, type Page } from '@playwright/test'

export type PWPage = Page

export async function createProject(page: PWPage, title: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.getByPlaceholder('The Great Novel...').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.locator('.ProseMirror')).toBeVisible()
}

export async function startInlineGeneration(page: PWPage) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await expect(page.locator('.ai-generating-text')).toBeVisible()
}

export async function placeCaretInsideZone(page: PWPage, mode: 'start' | 'end') {
  await page.evaluate((currentMode) => {
    const zone = document.querySelector('.ai-generating-text')
    if (!zone) return

    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()
    const node = zone.firstChild

    if (currentMode === 'start') {
      if (node) {
        range.setStart(node, 0)
      } else {
        range.setStart(zone, 0)
      }
    } else if (node && node.nodeType === Node.TEXT_NODE) {
      range.setStart(node, node.textContent?.length ?? 0)
    } else {
      range.setStartAfter(zone)
    }

    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }, mode)
}

export async function placeCaretAtZoneBoundary(page: PWPage, side: 'before' | 'after') {
  await page.evaluate((whichSide) => {
    const zone = document.querySelector('.ai-generating-text')
    if (!zone) return

    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()

    if (whichSide === 'before') {
      range.setStartBefore(zone)
    } else {
      range.setStartAfter(zone)
    }

    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }, side)
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

export async function placeCaretAtDocumentBoundary(page: PWPage, side: 'start' | 'end') {
  await page.evaluate((whichSide) => {
    const editor = document.querySelector('.ProseMirror')
    if (!editor) return

    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()

    if (whichSide === 'start') {
      range.selectNodeContents(editor)
      range.collapse(true)
    } else {
      range.selectNodeContents(editor)
      range.collapse(false)
    }

    selection.removeAllRanges()
    selection.addRange(range)
  }, side)
}

export async function editorText(page: PWPage): Promise<string> {
  return page.locator('.ProseMirror').innerText()
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
