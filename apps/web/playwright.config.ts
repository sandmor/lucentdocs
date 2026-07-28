import { defineConfig, devices } from '@playwright/test'

const TEST_HOST = process.env.LUCENTDOCS_TEST_HOST ?? '127.0.0.1'
const TEST_PORT = process.env.LUCENTDOCS_TEST_PORT ?? '5678'
const TEST_DATA_DIR = process.env.LUCENTDOCS_TEST_DATA_DIR ?? 'data-test'
const TEST_INLINE_DELAY_MS = process.env.LUCENTDOCS_TEST_INLINE_DELAY_MS ?? '1800'
const TEST_INLINE_SLOW_DELAY_MS = process.env.LUCENTDOCS_TEST_INLINE_SLOW_DELAY_MS ?? '60000'
const TEST_CHAT_DELAY_MS = process.env.LUCENTDOCS_TEST_CHAT_DELAY_MS ?? '1800'
const TEST_CHAT_SLOW_DELAY_MS = process.env.LUCENTDOCS_TEST_CHAT_SLOW_DELAY_MS ?? '8000'
const TEST_INLINE_PREVIEW_HOLD_MS = process.env.LUCENTDOCS_TEST_INLINE_PREVIEW_HOLD_MS ?? '1500'
const TEST_URL_HOST = TEST_HOST === '0.0.0.0' || TEST_HOST === '::' ? '127.0.0.1' : TEST_HOST
const TEST_BASE_URL = `http://${TEST_URL_HOST}:${TEST_PORT}`

function toEnvPrefix(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ')
}

const sharedTestEnv = {
  LUCENTDOCS_TEST_MODE: '1',
  LUCENTDOCS_TEST_DATA_DIR: TEST_DATA_DIR,
  LUCENTDOCS_TEST_FAKE_EMBEDDINGS: '1',
}

const serverTestEnv = {
  ...sharedTestEnv,
  NODE_ENV: 'test',
  LUCENTDOCS_DATA_DIR: TEST_DATA_DIR,
  LUCENTDOCS_TEST_INLINE_DELAY_MS: TEST_INLINE_DELAY_MS,
  LUCENTDOCS_TEST_INLINE_SLOW_DELAY_MS: TEST_INLINE_SLOW_DELAY_MS,
  LUCENTDOCS_TEST_CHAT_DELAY_MS: TEST_CHAT_DELAY_MS,
  LUCENTDOCS_TEST_CHAT_SLOW_DELAY_MS: TEST_CHAT_SLOW_DELAY_MS,
  LUCENTDOCS_TEST_INLINE_PREVIEW_HOLD_MS: TEST_INLINE_PREVIEW_HOLD_MS,
  YJS_PERSISTENCE_FLUSH_MS: '250',
  EMBEDDING_DEBOUNCE_MS: '0',
  EMBEDDING_BATCH_MAX_WAIT_MS: '250',
  HOST: TEST_HOST,
  PORT: TEST_PORT,
  AUTH_BOOTSTRAP_ADMIN_EMAIL: 'admin@lucentdocs.test',
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: 'admin12345',
}

const RESET_DATA_COMMAND = `${toEnvPrefix(sharedTestEnv)} bun src/test/reset-data-dir.ts`
const ENABLE_AUTH_COMMAND = `${toEnvPrefix(serverTestEnv)} bun src/test/enable-auth-for-e2e.ts`
const START_API_COMMAND = `${toEnvPrefix(serverTestEnv)} bun run start`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  // The application uses one reset SQLite store and the E2E flows intentionally
  // exercise collaboration between accounts, so worker isolation would be fake.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: TEST_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `cd ../api && ${RESET_DATA_COMMAND} && ${ENABLE_AUTH_COMMAND} && ${START_API_COMMAND}`,
    url: TEST_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'auth-setup',
      testMatch: '**/auth.setup.ts',
    },
    {
      name: 'chromium',
      dependencies: ['auth-setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/admin.json' },
    },
  ],
})
