import { expect, type Page } from '@playwright/test'

export type PWPage = Page

export async function waitForEditorReady(page: PWPage, timeout = 20_000) {
  await expect(page).toHaveURL(/\/project\/[^/?]+(?:\?.*)?$/, { timeout })
  await expect.poll(async () => page.locator('.ProseMirror').count(), { timeout }).toBe(1)
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout })
}

export async function waitForEditorConnected(page: PWPage, timeout = 20_000) {
  await waitForEditorReady(page, timeout)
  await expect(
    page.locator('[data-testid="connection-status"][data-status="connected"]')
  ).toBeVisible({
    timeout,
  })
}

export async function createProject(page: PWPage, title: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.getByPlaceholder('The Great Novel...').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()
  await waitForEditorConnected(page)
}

export async function startInlineGeneration(page: PWPage) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await expect(page.locator('.ai-writer-floating-controls[data-state="processing"]')).toBeVisible({
    timeout: 15_000,
  })
}

export async function placeCaretInsideZoneMiddle(page: PWPage) {
  await page.evaluate(() => {
    const zone = document.querySelector('.ai-generating-text')
    if (!zone) return

    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()

    const textNode = zone.firstChild
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      const textLength = textNode.textContent?.length ?? 0
      const offset = textLength > 1 ? Math.floor(textLength / 2) : 0
      range.setStart(textNode, offset)
    } else {
      range.selectNodeContents(zone)
      range.setStart(zone, 0)
    }

    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  })
}

export async function placeCaretAtText(page: PWPage, needle: string, occurrence = 0) {
  if (occurrence < 0) {
    throw new Error(`placeCaretAtText occurrence must be >= 0, received ${occurrence}`)
  }

  const found = await page.evaluate(
    ({ query, occurrenceIndex }) => {
      const root = document.querySelector('.ProseMirror')
      if (!root) return false

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let seen = 0

      while (walker.nextNode()) {
        const node = walker.currentNode
        const text = node.textContent ?? ''
        let start = 0

        while (start <= text.length) {
          const index = text.indexOf(query, start)
          if (index === -1) break

          if (seen === occurrenceIndex) {
            const selection = window.getSelection()
            if (!selection) return false

            const range = document.createRange()
            range.setStart(node, index + query.length)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
            return true
          }

          seen += 1
          start = index + Math.max(query.length, 1)
        }
      }

      return false
    },
    { query: needle, occurrenceIndex: occurrence }
  )

  expect(found).toBeTruthy()
}

export async function selectEditorText(page: PWPage, needle: string, occurrence = 0) {
  if (occurrence < 0) {
    throw new Error(`selectEditorText occurrence must be >= 0, received ${occurrence}`)
  }

  const found = await page.evaluate(
    ({ query, occurrenceIndex }) => {
      const root = document.querySelector('.ProseMirror')
      if (!root) return false

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let seen = 0

      while (walker.nextNode()) {
        const node = walker.currentNode
        const text = node.textContent ?? ''
        let start = 0

        while (start <= text.length) {
          const index = text.indexOf(query, start)
          if (index === -1) break

          if (seen === occurrenceIndex) {
            const selection = window.getSelection()
            if (!selection) return false

            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, index + query.length)
            selection.removeAllRanges()
            selection.addRange(range)
            return true
          }

          seen += 1
          start = index + Math.max(query.length, 1)
        }
      }
      return false
    },
    { query: needle, occurrenceIndex: occurrence }
  )

  expect(found).toBeTruthy()
}
