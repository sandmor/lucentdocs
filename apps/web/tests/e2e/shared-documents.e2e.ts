import { expect, test } from '@playwright/test'

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL('/')
}

async function createProject(page: import('@playwright/test').Page, title: string) {
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.getByPlaceholder('The Great Novel...').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.locator('.ProseMirror')).toBeVisible()
}

async function openShareDialog(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Open actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Share' }).click()
  const dialog = page.getByRole('dialog', { name: 'Share this document' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function createInvitedUser(
  admin: import('@playwright/test').Page,
  browser: import('@playwright/test').Browser,
  email: string,
  name: string,
  password: string
) {
  await admin.goto('/')
  await admin.getByRole('button', { name: /users/i }).click()
  await admin.getByLabel(/email/i).first().fill(email)
  await admin.getByRole('button', { name: /create invitation/i }).click()
  const inviteText = await admin.locator('text=Latest invitation link').locator('..').innerText()
  const signupPath = inviteText.match(/\/signup\?[^\s]+/)?.[0]
  expect(signupPath).toBeTruthy()
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(signupPath!)
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page).toHaveURL('/')
  return { context, page }
}

test('an invited editor mounts a shared document into another project and edits the same content', async ({
  browser,
  page,
}) => {
  await login(page, 'admin@lucentdocs.test', 'admin12345')
  const { context: editorContext, page: editor } = await createInvitedUser(
    page,
    browser,
    'editor@lucentdocs.test',
    'Editor',
    'editor-password-123'
  )
  try {
    await test.step('recipient creates a destination project', async () => {
      await createProject(editor, 'Editor research')
      await editor.goto('/')
    })

    await test.step('owner shares canonical content', async () => {
      await page.goto('/')
      // Sharing documents must not turn the recipient's project into an
      // administrator-visible/shared project.
      await expect(page.locator('#root').getByText('Editor research', { exact: true })).toHaveCount(
        0
      )
      await createProject(page, 'Owner manuscript')
      await page.locator('.ProseMirror').click()
      await page.keyboard.type('Canonical shared sentence')
      const shareDialog = await openShareDialog(page)
      await expect(shareDialog.getByRole('combobox')).toContainText('Can edit')
      await shareDialog.getByLabel('Registered email').fill('editor@lucentdocs.test')
      await shareDialog.getByRole('button', { name: 'Send invitation' }).click()
      const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Invitation sent' })
      await expect(toast).toBeVisible()
      await expect
        .poll(() => toast.evaluate((element) => element.closest('#root') === null))
        .toBe(true)
      await shareDialog.getByRole('button', { name: 'Done' }).click()
    })

    await test.step('recipient accepts into its own path', async () => {
      await editor.goto('/')
      await editor.getByRole('button', { name: /invitations/i }).click()
      await editor.getByRole('button', { name: 'Accept invitation' }).click()
      await editor.getByRole('dialog').getByRole('combobox').click()
      await editor.getByRole('option', { name: 'Editor research' }).click()
      await expect(editor.getByRole('dialog').getByRole('combobox')).toContainText(
        'Editor research'
      )
      await editor.getByLabel('File path in that project').fill('sources/owner-copy.md')
      await editor.getByRole('button', { name: 'Add to project' }).click()
      await expect(editor.getByText('Document added to your project')).toBeVisible()
      await editor
        .locator('#root')
        .getByText('Editor research', { exact: true })
        .click({ timeout: 8_000 })
      await editor.getByRole('button', { name: /sources/ }).click()
      await editor.getByRole('button', { name: /owner-copy\.md/ }).click({ timeout: 8_000 })
      await expect(editor.locator('.ProseMirror')).toContainText('Canonical shared sentence')
    })
    await test.step('editor update reaches owner over Yjs', async () => {
      await editor.locator('.ProseMirror').click()
      await editor.keyboard.type(' — edited remotely')
      await expect(page.locator('.ProseMirror')).toContainText('edited remotely')
    })
  } finally {
    await editorContext.close()
  }
})

test('a viewer can read a mounted document but revocation removes it without touching the owner copy', async ({
  browser,
  page,
}) => {
  await login(page, 'admin@lucentdocs.test', 'admin12345')
  const { context: viewerContext, page: viewer } = await createInvitedUser(
    page,
    browser,
    'viewer@lucentdocs.test',
    'Viewer',
    'viewer-password-123'
  )
  try {
    await createProject(viewer, 'Viewer references')
    await viewer.goto('/')

    await page.goto('/')
    await createProject(page, 'Owner viewer test')
    await page.locator('.ProseMirror').click()
    await page.keyboard.type('The owner copy remains canonical')
    const shareDialog = await openShareDialog(page)
    await shareDialog.getByLabel('Registered email').fill('viewer@lucentdocs.test')
    await shareDialog.getByRole('combobox').click()
    await page.getByRole('option', { name: 'View only' }).click()
    await expect(shareDialog.getByRole('combobox')).toContainText('View only')
    await shareDialog.getByRole('button', { name: 'Send invitation' }).click()
    await shareDialog.getByRole('button', { name: 'Done' }).click()

    await viewer.goto('/')
    await viewer.getByRole('button', { name: /invitations/i }).click()
    await viewer.getByRole('button', { name: 'Accept invitation' }).click()
    await viewer.getByRole('dialog').getByRole('combobox').click()
    await viewer.getByRole('option', { name: 'Viewer references' }).click()
    await viewer.getByLabel('File path in that project').fill('sources/read-only.md')
    await viewer.getByRole('button', { name: 'Add to project' }).click()
    await viewer
      .locator('#root')
      .getByText('Viewer references', { exact: true })
      .click({ timeout: 8_000 })
    await viewer.getByRole('button', { name: /sources/ }).click()
    await viewer.getByRole('button', { name: /read-only\.md/ }).click({ timeout: 8_000 })
    await expect(viewer.locator('.ProseMirror')).toContainText('The owner copy remains canonical')
    await expect(viewer.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    await viewer.getByRole('button', { name: /assistant/i }).click()
    await expect(viewer.locator('[data-chat-editing-toggle="true"]')).toBeDisabled()

    const manageDialog = await openShareDialog(page)
    await manageDialog.getByRole('button', { name: 'Revoke Viewer' }).click()
    await manageDialog.getByRole('button', { name: 'Done' }).click()
    await expect(page.locator('.ProseMirror')).toContainText('The owner copy remains canonical')

    await viewer.goto('/')
    await viewer.locator('#root').getByText('Viewer references', { exact: true }).click()
    await expect(viewer.locator('.ProseMirror')).not.toContainText(
      'The owner copy remains canonical'
    )
  } finally {
    await viewerContext.close()
  }
})
