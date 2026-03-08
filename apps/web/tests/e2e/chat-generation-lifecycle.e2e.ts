import { expect, test, type Page } from '@playwright/test'
import { createProject, waitForEditorConnected } from './helpers/inline-ai'

async function openChatPanel(page: Page): Promise<void> {
  const panel = page.locator('[data-chat-panel="true"]')
  if (await panel.isVisible()) return

  await page.locator('[data-sidebar-panel="chat"]').click()
  await expect(panel).toBeVisible()
}

async function sendChatMessage(page: Page, message: string): Promise<void> {
  await openChatPanel(page)
  const input = page.locator('[data-chat-input="true"]')
  await input.fill(message)
  await input.press('Enter')
  await waitForChatGenerationToStart(page)
}

async function waitForChatGenerationToStart(page: Page, timeout = 20_000): Promise<void> {
  const chatPanel = page.locator('[data-chat-panel="true"]')
  const stopButton = page.locator('[data-chat-stop="true"]')
  const typingIndicator = page.getByLabel('Assistant is typing')

  await expect
    .poll(
      async () => {
        if ((await stopButton.count()) > 0) {
          return true
        }

        if ((await typingIndicator.count()) > 0) {
          return true
        }

        return (await chatPanel.textContent())?.includes('spark') ?? false
      },
      { timeout }
    )
    .toBe(true)
}

async function selectFirstChatThread(page: Page): Promise<void> {
  await openChatPanel(page)
  await page.locator('[data-chat-history-toggle="true"]').click()
  const firstThread = page.locator('[data-chat-thread-select]').first()
  await expect(firstThread).toBeVisible({ timeout: 8_000 })
  await firstThread.click()
}

test('sidebar chat stop aborts an in-flight generation without saving assistant output', async ({
  page,
}) => {
  await createProject(page, 'Chat Stop Abort')

  await sendChatMessage(page, 'Abort this chat response')
  await page.locator('[data-chat-stop="true"]').click()

  await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.locator('[data-chat-panel="true"]')).toContainText('Abort this chat response')
  await expect(page.locator('[data-chat-panel="true"]')).not.toContainText('spark')
})

test('sidebar chat generation survives initiator disconnect and reconnecting client can resume in-flight thread', async ({
  browser,
  page,
}) => {
  await createProject(page, 'Chat Reconnect Resume')
  const url = page.url()

  const peerContext = await browser.newContext()
  const peerPage = await peerContext.newPage()

  try {
    await peerPage.goto(url)
    await waitForEditorConnected(peerPage)
    await openChatPanel(peerPage)

    await sendChatMessage(page, 'Seed message')
    await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 12_000 })
    await expect(page.locator('[data-chat-panel="true"]')).toContainText('spark', {
      timeout: 12_000,
    })

    await sendChatMessage(page, 'Give me a mobile continuation')
    await page.close()

    await selectFirstChatThread(peerPage)
    await waitForChatGenerationToStart(peerPage)
    await expect(peerPage.locator('[data-chat-panel="true"]')).toContainText('mobile', {
      timeout: 20_000,
    })
    await expect(peerPage.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await peerContext.close()
  }
})
