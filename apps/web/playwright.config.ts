import { defineConfig, devices } from '@playwright/test'

const TEST_HOST = process.env.PLOTLINE_TEST_HOST ?? '127.0.0.1'
const TEST_PORT = process.env.PLOTLINE_TEST_PORT ?? '5678'
const TEST_DATA_DIR = process.env.PLOTLINE_TEST_DATA_DIR ?? 'data-test'
const TEST_URL_HOST = TEST_HOST === '0.0.0.0' || TEST_HOST === '::' ? '127.0.0.1' : TEST_HOST
const TEST_BASE_URL = `http://${TEST_URL_HOST}:${TEST_PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './tests/global-setup.ts',
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: TEST_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `cd ../.. && PLOTLINE_TEST_MODE=1 NODE_ENV=test PLOTLINE_DATA_DIR=${TEST_DATA_DIR} HOST=${TEST_HOST} PORT=${TEST_PORT} bun run dev`,
    url: TEST_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
