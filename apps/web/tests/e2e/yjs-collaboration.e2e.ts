import { expect, test } from '@playwright/test'
import { createProject, placeCaretAtText } from './helpers/inline-ai'

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

test('remote caret overlay stays aligned with the receiving editor', async ({ browser, page }) => {
  await createProject(page, 'Yjs Remote Caret Overlay')

  const url = page.url()
  const contextTwo = await browser.newContext()
  const pageTwo = await contextTwo.newPage()

  try {
    await pageTwo.goto(url)

    const editorOne = page.locator('.ProseMirror')
    const editorTwo = pageTwo.locator('.ProseMirror')
    const remoteCaret = pageTwo.locator('.ai-remote-presence-caret')

    await expect(editorOne).toBeVisible()
    await expect(editorTwo).toBeVisible()

    await editorOne.click()
    await page.keyboard.type('Remote caret anchor')

    await expect(remoteCaret).toBeVisible({ timeout: 10_000 })

    const geometry = await pageTwo.evaluate(() => {
      const editor = document.querySelector('.ProseMirror') as HTMLElement | null
      const caret = document.querySelector('.ai-remote-presence-caret') as HTMLElement | null
      const label = document.querySelector('.ai-remote-presence-label') as HTMLElement | null

      if (!editor || !caret) {
        return null
      }

      const editorRect = editor.getBoundingClientRect()
      const caretRect = caret.getBoundingClientRect()
      const labelRect = label?.getBoundingClientRect() ?? null

      return {
        viewportHeight: window.innerHeight,
        editor: {
          left: editorRect.left,
          right: editorRect.right,
          top: editorRect.top,
          bottom: editorRect.bottom,
        },
        caret: {
          left: caretRect.left,
          right: caretRect.right,
          top: caretRect.top,
          bottom: caretRect.bottom,
          height: caretRect.height,
        },
        label: labelRect
          ? {
              left: labelRect.left,
              right: labelRect.right,
              top: labelRect.top,
              bottom: labelRect.bottom,
            }
          : null,
      }
    })

    expect(geometry).not.toBeNull()
    expect(geometry!.caret.height).toBeGreaterThan(0)
    expect(geometry!.caret.top).toBeGreaterThanOrEqual(geometry!.editor.top - 24)
    expect(geometry!.caret.bottom).toBeLessThanOrEqual(geometry!.editor.bottom + 24)
    expect(geometry!.caret.top).toBeLessThanOrEqual(geometry!.viewportHeight)
    expect(geometry!.caret.left).toBeGreaterThanOrEqual(geometry!.editor.left - 24)
    expect(geometry!.caret.left).toBeLessThanOrEqual(geometry!.editor.right + 24)

    if (geometry!.label) {
      expect(geometry!.label.top).toBeLessThanOrEqual(geometry!.caret.bottom + 8)
      expect(geometry!.label.bottom).toBeGreaterThanOrEqual(geometry!.editor.top - 48)
    }
  } finally {
    await contextTwo.close()
  }
})

test('remote caret remains visible after undo moves the source selection', async ({
  browser,
  page,
}) => {
  await createProject(page, 'Yjs Undo Caret Presence')

  const url = page.url()
  const contextTwo = await browser.newContext()
  const pageTwo = await contextTwo.newPage()

  try {
    await pageTwo.goto(url)

    const editorOne = page.locator('.ProseMirror')
    const editorTwo = pageTwo.locator('.ProseMirror')
    const remoteCaret = pageTwo.locator('.ai-remote-presence-caret')
    const undoShortcut = process.platform === 'darwin' ? 'Meta+z' : 'Control+z'

    await expect(editorOne).toBeVisible()
    await expect(editorTwo).toBeVisible()

    await editorOne.click()
    await page.keyboard.type('Undo presence anchor')
    await expect(editorTwo).toContainText('Undo presence anchor')

    await expect(remoteCaret).toBeVisible({ timeout: 10_000 })

    await page.keyboard.press(undoShortcut)
    await expect(editorTwo).not.toContainText('Undo presence anchor')
    await expect(remoteCaret).toBeVisible({ timeout: 10_000 })

    const geometry = await pageTwo.evaluate(() => {
      const editor = document.querySelector('.ProseMirror') as HTMLElement | null
      const caret = document.querySelector('.ai-remote-presence-caret') as HTMLElement | null

      if (!editor || !caret) return null

      const editorRect = editor.getBoundingClientRect()
      const caretRect = caret.getBoundingClientRect()

      return {
        editorTop: editorRect.top,
        editorBottom: editorRect.bottom,
        caretTop: caretRect.top,
        caretBottom: caretRect.bottom,
      }
    })

    expect(geometry).not.toBeNull()
    expect(geometry!.caretTop).toBeGreaterThanOrEqual(geometry!.editorTop - 24)
    expect(geometry!.caretBottom).toBeLessThanOrEqual(geometry!.editorBottom + 24)
  } finally {
    await contextTwo.close()
  }
})

test('remote caret placement does not flash a transient remote selection', async ({
  browser,
  page,
}) => {
  await createProject(page, 'Yjs Remote Caret No Flash')

  const url = page.url()
  const contextTwo = await browser.newContext()
  const pageTwo = await contextTwo.newPage()

  try {
    await pageTwo.goto(url)

    const editorOne = page.locator('.ProseMirror')
    const editorTwo = pageTwo.locator('.ProseMirror')
    const remoteCaret = page.locator('.ai-remote-presence-caret')
    const remoteSelection = page.locator('.ai-remote-presence-selection')

    await expect(editorOne).toBeVisible()
    await expect(editorTwo).toBeVisible()

    await editorOne.click()
    await page.keyboard.type('Transient selection flash check')
    await expect(editorTwo).toContainText('Transient selection flash check')

    await page.evaluate(() => {
      const events: number[] = []
      const observer = new MutationObserver(() => {
        if (document.querySelector('.ai-remote-presence-selection')) {
          events.push(performance.now())
        }
      })

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      })
      ;(
        window as Window & {
          __presenceSelectionFlashEvents?: number[]
          __presenceSelectionFlashObserver?: MutationObserver
        }
      ).__presenceSelectionFlashEvents = events
      ;(
        window as Window & {
          __presenceSelectionFlashEvents?: number[]
          __presenceSelectionFlashObserver?: MutationObserver
        }
      ).__presenceSelectionFlashObserver = observer
    })

    await editorTwo.click()
    await placeCaretAtText(pageTwo, 'Transient selection flash check')

    await expect(remoteCaret).toBeVisible({ timeout: 10_000 })
    await expect(remoteSelection).toHaveCount(0)
    await page.waitForTimeout(250)

    const flashEvents = await page.evaluate(() => {
      const win = window as Window & {
        __presenceSelectionFlashEvents?: number[]
        __presenceSelectionFlashObserver?: MutationObserver
      }

      win.__presenceSelectionFlashObserver?.disconnect()
      return [...(win.__presenceSelectionFlashEvents ?? [])]
    })

    expect(flashEvents).toEqual([])
  } finally {
    await contextTwo.close()
  }
})
