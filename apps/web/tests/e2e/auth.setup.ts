import { expect, test as setup } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

setup('authenticate the default E2E administrator', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('admin@lucentdocs.test')
  await page.getByLabel('Password').fill('admin12345')
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL('/')
  await mkdir('playwright/.auth', { recursive: true })
  await page.context().storageState({ path: 'playwright/.auth/admin.json' })
})
