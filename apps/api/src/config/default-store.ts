import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createConnection } from '../infrastructure/sqlite/connection.js'
import { SqliteAppConfigRepository } from '../infrastructure/sqlite/appConfig.adapter.js'
import { DEFAULT_DATA_DIR, SQLITE_FILE_NAME, resolveDataDir, resolveDataFile } from '../paths.js'
import type { ConfigStoreHandle } from './manager.js'

const DEFAULT_TEST_DATA_DIR = 'data-test'
const TEST_MODE_ENV_VAR = 'LUCENTDOCS_TEST_MODE'
const TEST_DATA_DIR_ENV_VAR = 'LUCENTDOCS_TEST_DATA_DIR'
const ALLOW_UNSAFE_TEST_DB_ENV_VAR = 'LUCENTDOCS_ALLOW_UNSAFE_TEST_DB'

function normalizeDataDir(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : DEFAULT_DATA_DIR
}

function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function isTestRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV?.trim() === 'test' || isTruthyEnvValue(env[TEST_MODE_ENV_VAR])
}

function isMainDataDir(dataDir: string): boolean {
  return path.resolve(resolveDataDir(dataDir)) === path.resolve(resolveDataDir(DEFAULT_DATA_DIR))
}

function resolveConfiguredDataDir(env: NodeJS.ProcessEnv): string {
  const configuredDataDir = normalizeDataDir(env.LUCENTDOCS_DATA_DIR)
  const configuredTestDataDir = env[TEST_DATA_DIR_ENV_VAR]?.trim()
  const desiredDataDir = normalizeDataDir(configuredTestDataDir ?? configuredDataDir)

  if (!isTestRuntime(env) || isTruthyEnvValue(env[ALLOW_UNSAFE_TEST_DB_ENV_VAR])) {
    return desiredDataDir
  }

  if (!isMainDataDir(desiredDataDir)) return desiredDataDir
  return DEFAULT_TEST_DATA_DIR
}

export function createDefaultConfigStore(env: NodeJS.ProcessEnv): ConfigStoreHandle {
  const configuredDataDir = resolveConfiguredDataDir(env)
  const dataDirPath = resolveDataDir(configuredDataDir)
  const dbFilePath = resolveDataFile(configuredDataDir, SQLITE_FILE_NAME)

  mkdirSync(dataDirPath, { recursive: true })

  const connection = createConnection(dbFilePath)
  const repository = new SqliteAppConfigRepository(connection)

  return {
    dataDirPath,
    dbFilePath,
    repository,
    dispose: () => {
      connection.close()
    },
  }
}
