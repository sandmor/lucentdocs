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
  const stopButton = page.locator('[data-chat-stop="true"]')
  const typingIndicator = page.getByLabel('Assistant is typing')

  await expect
    .poll(
      async () => {
        if ((await stopButton.count()) > 0) {
          return true
        }

        return (await typingIndicator.count()) > 0
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

test('sidebar chat message edits and truncating deletes sync across clients', async ({
  browser,
  page,
}) => {
  await createProject(page, 'Collaborative Chat Revisions')
  await sendChatMessage(page, 'Original collaborative prompt')
  await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 12_000 })

  const peerContext = await browser.newContext()
  const peerPage = await peerContext.newPage()

  try {
    await peerPage.goto(page.url())
    await waitForEditorConnected(peerPage)
    await selectFirstChatThread(peerPage)
    const peerMessages = peerPage.locator('[data-chat-message-id]')
    await expect(peerMessages.filter({ hasText: 'Original collaborative prompt' })).toHaveCount(1)

    const originalMessage = page
      .locator('[data-chat-message-id]')
      .filter({ hasText: 'Original collaborative prompt' })
      .first()
    const originalMessageId = await originalMessage.getAttribute('data-chat-message-id')
    if (!originalMessageId) throw new Error('Expected the original message id')

    await originalMessage.locator('[data-chat-message-actions]').click()
    await page.locator(`[data-chat-message-edit="${originalMessageId}"]`).click()
    await page
      .locator(`[data-chat-message-edit-input="${originalMessageId}"]`)
      .fill('Revised collaborative prompt')
    await page.locator(`[data-chat-message-edit-save="${originalMessageId}"]`).click()

    await expect(peerMessages.filter({ hasText: 'Revised collaborative prompt' })).toHaveCount(1)
    await expect(peerMessages.filter({ hasText: 'Original collaborative prompt' })).toHaveCount(0)

    await sendChatMessage(page, 'Remove this turn and everything after it')
    await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 12_000 })

    const secondMessage = page
      .locator('[data-chat-message-id]')
      .filter({ hasText: 'Remove this turn and everything after it' })
      .first()
    const secondMessageId = await secondMessage.getAttribute('data-chat-message-id')
    if (!secondMessageId) throw new Error('Expected the second message id')

    await secondMessage.locator('[data-chat-message-actions]').click()
    await page.locator(`[data-chat-message-delete="${secondMessageId}"]`).click()
    await page.locator(`[data-chat-message-delete-from="${secondMessageId}"]`).click()

    await expect(
      peerMessages.filter({ hasText: 'Remove this turn and everything after it' })
    ).toHaveCount(0)
    await expect(peerMessages.filter({ hasText: 'Revised collaborative prompt' })).toHaveCount(1)

    await sendChatMessage(page, 'Keep generating while actions are checked')
    await expect(
      page.locator(`[data-chat-message-actions="${originalMessageId}"]`)
    ).toBeDisabled()
    await page.locator('[data-chat-stop="true"]').click()
  } finally {
    await peerContext.close()
  }
})

test('sidebar chat can regenerate after deleting the latest assistant reply', async ({ page }) => {
  await createProject(page, 'Chat Continue After Delete')

  await sendChatMessage(page, 'Continue after assistant delete')
  await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 12_000 })

  const assistantMessage = page
    .locator('[data-chat-message-id]')
    .filter({ hasText: 'Editorial Assistant' })
    .last()
  const assistantMessageId = await assistantMessage.getAttribute('data-chat-message-id')
  if (!assistantMessageId) throw new Error('Expected the assistant message id')

  await assistantMessage.locator('[data-chat-message-actions]').click()
  await page.locator(`[data-chat-message-delete="${assistantMessageId}"]`).click()
  await page.locator(`[data-chat-message-delete-only="${assistantMessageId}"]`).click()

  await expect(
    page.locator('[data-chat-message-id]').filter({ hasText: 'Editorial Assistant' })
  ).toHaveCount(0)

  const input = page.locator('[data-chat-input="true"]')
  await input.fill('')
  await expect(page.locator('[data-chat-send="true"]')).toBeEnabled()
  await page.locator('[data-chat-send="true"]').click()

  await waitForChatGenerationToStart(page)
  await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 12_000 })
  await expect(
    page.locator('[data-chat-message-id]').filter({ hasText: 'Editorial Assistant' })
  ).toHaveCount(1)
  await expect(
    page.locator('[data-chat-message-id]').filter({ hasText: 'Continue after assistant delete' })
  ).toHaveCount(1)
})

test('sidebar chat root fork pager keeps multiple first-message regenerations', async ({ page }) => {
  await createProject(page, 'Chat Root Fork Pager')

  await sendChatMessage(page, 'Root fork prompt')
  await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 12_000 })

  const userMessage = page
    .locator('[data-chat-message-id]')
    .filter({ hasText: 'Root fork prompt' })
    .first()
  const originalUserMessageId = await userMessage.getAttribute('data-chat-message-id')
  if (!originalUserMessageId) throw new Error('Expected the user message id')

  await userMessage.locator('[data-chat-message-actions]').click()
  await page.locator(`[data-chat-message-regenerate="${originalUserMessageId}"]`).click()
  await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 12_000 })

  const activeUserMessage = page
    .locator('[data-chat-message-id]')
    .filter({ hasText: 'Root fork prompt' })
    .first()
  const activeUserMessageId = await activeUserMessage.getAttribute('data-chat-message-id')
  if (!activeUserMessageId) throw new Error('Expected the active user message id')

  await expect(page.locator(`[data-chat-branch-pager="${activeUserMessageId}"]`)).toBeVisible()
  await expect(page.locator(`[data-chat-branch-label="${activeUserMessageId}"]`)).toHaveText('2 / 2')

  await page.locator(`[data-chat-branch-prev="${activeUserMessageId}"]`).click()
  await expect(page.locator(`[data-chat-branch-label="${originalUserMessageId}"]`)).toHaveText('1 / 2')
  await expect(page.locator('[data-chat-panel="true"]')).toContainText('spark')

  await page.locator(`[data-chat-branch-next="${originalUserMessageId}"]`).click()
  await expect(page.locator(`[data-chat-branch-label="${activeUserMessageId}"]`)).toHaveText('2 / 2')
})

test('sidebar chat branch pager keeps multiple assistant regenerations', async ({ page }) => {
  await createProject(page, 'Chat Branch Pager')

  await sendChatMessage(page, 'Branch pager prompt')
  await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 12_000 })

  const assistantMessage = page
    .locator('[data-chat-message-id]')
    .filter({ hasText: 'Editorial Assistant' })
    .last()
  const originalAssistantMessageId = await assistantMessage.getAttribute('data-chat-message-id')
  if (!originalAssistantMessageId) throw new Error('Expected the assistant message id')

  await assistantMessage.locator('[data-chat-message-actions]').click()
  await page.locator(`[data-chat-message-regenerate="${originalAssistantMessageId}"]`).click()
  await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 12_000 })

  const activeAssistantMessage = page
    .locator('[data-chat-message-id]')
    .filter({ hasText: 'Editorial Assistant' })
    .last()
  const activeAssistantMessageId = await activeAssistantMessage.getAttribute('data-chat-message-id')
  if (!activeAssistantMessageId) throw new Error('Expected the active assistant message id')

  await expect(
    page.locator(`[data-chat-branch-pager="${activeAssistantMessageId}"]`)
  ).toBeVisible()
  await expect(page.locator(`[data-chat-branch-label="${activeAssistantMessageId}"]`)).toHaveText(
    '2 / 2'
  )

  await page.locator(`[data-chat-branch-prev="${activeAssistantMessageId}"]`).click()
  await expect(page.locator(`[data-chat-branch-label="${originalAssistantMessageId}"]`)).toHaveText(
    '1 / 2'
  )
  await expect(page.locator('[data-chat-panel="true"]')).toContainText('spark')

  await page.locator(`[data-chat-branch-next="${originalAssistantMessageId}"]`).click()
  await expect(page.locator(`[data-chat-branch-label="${activeAssistantMessageId}"]`)).toHaveText(
    '2 / 2'
  )
})

test('sidebar chat branch switch syncs to another connected client', async ({ browser, page }) => {
  await createProject(page, 'Chat Branch Sync')
  await sendChatMessage(page, 'Branch sync prompt')
  await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 12_000 })

  const assistantMessage = page
    .locator('[data-chat-message-id]')
    .filter({ hasText: 'Editorial Assistant' })
    .last()
  const originalAssistantMessageId = await assistantMessage.getAttribute('data-chat-message-id')
  if (!originalAssistantMessageId) throw new Error('Expected the assistant message id')

  await assistantMessage.locator('[data-chat-message-actions]').click()
  await page.locator(`[data-chat-message-regenerate="${originalAssistantMessageId}"]`).click()
  await expect(page.locator('[data-chat-stop="true"]')).toHaveCount(0, { timeout: 12_000 })

  const activeAssistantMessage = page
    .locator('[data-chat-message-id]')
    .filter({ hasText: 'Editorial Assistant' })
    .last()
  const activeAssistantMessageId = await activeAssistantMessage.getAttribute('data-chat-message-id')
  if (!activeAssistantMessageId) throw new Error('Expected the active assistant message id')

  const peerContext = await browser.newContext()
  const peerPage = await peerContext.newPage()

  try {
    await peerPage.goto(page.url())
    await waitForEditorConnected(peerPage)
    await selectFirstChatThread(peerPage)
    await expect(
      peerPage.locator(`[data-chat-branch-label="${activeAssistantMessageId}"]`)
    ).toHaveText('2 / 2')

    await page.locator(`[data-chat-branch-prev="${activeAssistantMessageId}"]`).click()
    await expect(
      page.locator(`[data-chat-branch-label="${originalAssistantMessageId}"]`)
    ).toHaveText('1 / 2')

    await expect(
      peerPage.locator(`[data-chat-branch-label="${originalAssistantMessageId}"]`)
    ).toHaveText('1 / 2', { timeout: 8_000 })
    await expect(peerPage.locator('[data-chat-panel="true"]')).toContainText('spark')
  } finally {
    await peerContext.close()
  }
})

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
