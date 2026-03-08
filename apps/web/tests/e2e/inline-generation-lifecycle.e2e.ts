import { expect, test } from '@playwright/test'
import { createProject, startInlineGeneration, waitForEditorConnected } from './helpers/inline-ai'

test('inline stop aborts an in-flight continuation without inserting output', async ({ page }) => {
  await createProject(page, 'Inline Stop Abort')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('Once ')
  await startInlineGeneration(page)

  await page.locator('.ai-writer-floating-controls [data-action="stop"]').click({ force: true })

  await expect(page.locator('.ai-writer-floating-controls[data-state="processing"]')).toHaveCount(
    0,
    {
      timeout: 10_000,
    }
  )
  await expect(editor).toContainText('Once')
  await expect(editor).not.toContainText('spark')
})

test('undo after continuation start removes zone and preserves original text', async ({ page }) => {
  await createProject(page, 'Inline Undo Zone Creation')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('Once ')
  await startInlineGeneration(page)

  const undoShortcut = process.platform === 'darwin' ? 'Meta+z' : 'Control+z'
  await page.keyboard.press(undoShortcut)

  await expect(page.locator('.ai-generating-text')).toHaveCount(0)
  await expect(page.locator('.ai-writer-floating-controls')).toHaveCount(0)
  await expect(editor).toContainText('Once')
  await expect(editor).not.toContainText('spark')
})

test('inline generation continues after initiator disconnect and reconnecting client receives completion', async ({
  browser,
  page,
}) => {
  await createProject(page, 'Inline Reconnect Resume')

  const url = page.url()
  const peerContext = await browser.newContext()
  const peerPage = await peerContext.newPage()

  try {
    await peerPage.goto(url)
    await waitForEditorConnected(peerPage)
    const peerEditor = peerPage.locator('.ProseMirror')
    await expect(peerEditor).toBeVisible()

    const editorOne = page.locator('.ProseMirror')
    await editorOne.click()
    await page.keyboard.type('Once ')
    await startInlineGeneration(page)

    await expect(
      peerPage.locator('.ai-writer-floating-controls[data-state="processing"]')
    ).toBeVisible({ timeout: 8_000 })

    await page.close()
    await peerPage.reload()
    await waitForEditorConnected(peerPage)

    const processingControls = peerPage.locator(
      '.ai-writer-floating-controls[data-state="processing"]'
    )
    await expect
      .poll(
        async () => {
          if ((await processingControls.count()) > 0) return true
          return (await peerEditor.textContent())?.includes('Once spark') ?? false
        },
        {
          timeout: 20_000,
        }
      )
      .toBe(true)

    await expect(peerEditor).toContainText('Once spark', { timeout: 20_000 })
    await expect(processingControls).toHaveCount(0)
  } finally {
    await peerContext.close()
  }
})
