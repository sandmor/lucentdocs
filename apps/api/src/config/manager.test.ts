import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { DEFAULT_PERSISTED_CONFIG } from '@plotline/shared'
import { createConnection } from '../infrastructure/sqlite/connection.js'
import { SqliteAppConfigRepository } from '../infrastructure/sqlite/appConfig.adapter.js'
import { SQLITE_FILE_NAME, resolveDataDir, resolveDataFile } from '../paths.js'
import { createDefaultConfigStore } from './default-store.js'
import { ConfigManager } from './manager.js'

function uniqueDataDir(label: string): string {
  return `data-test/${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function seedPersistedConfig(
  dataDir: string,
  values: Partial<typeof DEFAULT_PERSISTED_CONFIG>
): void {
  const dbFilePath = resolveDataFile(dataDir, SQLITE_FILE_NAME)
  const connection = createConnection(dbFilePath)
  const repository = new SqliteAppConfigRepository(connection)
  repository.upsertMany(values, Date.now())
  connection.close()
}

describe('ConfigManager', () => {
  test('merges env over database over defaults while preserving persisted values', () => {
    const dataDir = uniqueDataDir('config-manager-priority')
    const absoluteDataDir = resolveDataDir(dataDir)

    rmSync(absoluteDataDir, { recursive: true, force: true })
    mkdirSync(absoluteDataDir, { recursive: true })

    seedPersistedConfig(dataDir, {
      host: '0.0.0.0',
      port: 6000,
      aiDefaultTemperature: 0.4,
      yjsPersistenceFlushMs: 3333,
    })

    const manager = new ConfigManager(
      {
        NODE_ENV: 'test',
        HOST: '127.0.0.9',
        PORT: '1234',
        PLOTLINE_DATA_DIR: dataDir,
        AI_DEFAULT_TEMPERATURE: '0.8',
        YJS_VERSION_INTERVAL_MS: '9000',
      },
      {
        storeProvider: createDefaultConfigStore,
      }
    )

    const state = manager.getState()
    const config = state.config

    expect(config.runtime.nodeEnv).toBe('test')
    expect(config.server.host).toBe('127.0.0.9')
    expect(config.server.port).toBe(1234)
    expect(config.paths.dataDir).toBe(absoluteDataDir)

    expect(config.ai.defaultTemperature).toBe(0.8)
    expect(config.ai.selectionEditTemperature).toBe(
      DEFAULT_PERSISTED_CONFIG.aiSelectionEditTemperature
    )
    expect(config.ai.defaultMaxOutputTokens).toBe(DEFAULT_PERSISTED_CONFIG.aiDefaultMaxOutputTokens)

    expect(config.yjs.persistenceFlushIntervalMs).toBe(3333)
    expect(config.yjs.versionSnapshotIntervalMs).toBe(9000)

    expect(state.persistedConfig.host).toBe('0.0.0.0')
    expect(state.persistedConfig.port).toBe(6000)
    expect(state.persistedConfig.aiDefaultTemperature).toBe(0.4)
    expect(state.sources.host).toBe('env')
    expect(state.sources.port).toBe('env')
    expect(state.sources.aiDefaultTemperature).toBe('env')

    manager.resetForTests()
    rmSync(absoluteDataDir, { recursive: true, force: true })
  })

  test('creates default persisted config records when database is empty', () => {
    const dataDir = uniqueDataDir('config-manager-default-db')
    const absoluteDataDir = resolveDataDir(dataDir)
    rmSync(absoluteDataDir, { recursive: true, force: true })

    const manager = new ConfigManager(
      {
        NODE_ENV: 'test',
        PLOTLINE_DATA_DIR: dataDir,
      },
      {
        storeProvider: createDefaultConfigStore,
      }
    )

    const state = manager.getState()

    expect(state.persistedConfig.nodeEnv).toBe(DEFAULT_PERSISTED_CONFIG.nodeEnv)
    expect(state.persistedConfig.host).toBe(DEFAULT_PERSISTED_CONFIG.host)
    expect(state.persistedConfig.port).toBe(DEFAULT_PERSISTED_CONFIG.port)
    expect(state.persistedConfig.aiDefaultTemperature).toBe(
      DEFAULT_PERSISTED_CONFIG.aiDefaultTemperature
    )

    const dbFilePath = resolveDataFile(dataDir, SQLITE_FILE_NAME)
    const connection = createConnection(dbFilePath)
    const countRow = connection.get<{ total: number }>(
      'SELECT COUNT(*) as total FROM app_config_values',
      []
    )
    expect(countRow?.total).toBeGreaterThanOrEqual(1)
    connection.close()

    manager.resetForTests()
    rmSync(absoluteDataDir, { recursive: true, force: true })
  })

  test('updates database config and reports env-overridden fields', () => {
    const dataDir = uniqueDataDir('config-manager-update')
    const absoluteDataDir = resolveDataDir(dataDir)

    rmSync(absoluteDataDir, { recursive: true, force: true })
    mkdirSync(absoluteDataDir, { recursive: true })

    const manager = new ConfigManager(
      {
        NODE_ENV: 'test',
        PLOTLINE_DATA_DIR: dataDir,
        AI_DEFAULT_TEMPERATURE: '1.2',
        YJS_PERSISTENCE_FLUSH_MS: '2500',
        LIMITS_AI_TOOL_STEPS: '11',
      },
      {
        storeProvider: createDefaultConfigStore,
      }
    )

    const result = manager.updatePersistedConfig({
      aiDefaultTemperature: 0.2,
      yjsPersistenceFlushMs: 7777,
      maxAiToolSteps: 7,
    })

    expect(result.changedPersistedKeys.sort()).toEqual([
      'aiDefaultTemperature',
      'maxAiToolSteps',
      'yjsPersistenceFlushMs',
    ])
    expect(result.changedEffectiveKeys).toEqual([])
    expect(result.overriddenChangedKeys.sort()).toEqual([
      'aiDefaultTemperature',
      'maxAiToolSteps',
      'yjsPersistenceFlushMs',
    ])
    expect(result.state.config.ai.defaultTemperature).toBe(1.2)
    expect(result.state.config.yjs.persistenceFlushIntervalMs).toBe(2500)
    expect(result.state.config.limits.aiToolSteps).toBe(11)

    const dbFilePath = resolveDataFile(dataDir, SQLITE_FILE_NAME)
    const connection = createConnection(dbFilePath)
    const rows = connection.all<{ key: string; value: string }>(
      'SELECT key, value FROM app_config_values WHERE key IN (?, ?, ?)',
      ['aiDefaultTemperature', 'yjsPersistenceFlushMs', 'maxAiToolSteps']
    )
    const rowMap = Object.fromEntries(rows.map((row) => [row.key, row.value]))

    expect(rowMap.aiDefaultTemperature).toBe('0.2')
    expect(rowMap.yjsPersistenceFlushMs).toBe('7777')
    expect(rowMap.maxAiToolSteps).toBe('7')

    connection.close()
    manager.resetForTests()
    rmSync(absoluteDataDir, { recursive: true, force: true })
  })

  test('ignores invalid persisted values and keeps source as default', () => {
    const dataDir = uniqueDataDir('config-manager-invalid-db-values')
    const absoluteDataDir = resolveDataDir(dataDir)
    const dbFilePath = resolveDataFile(dataDir, SQLITE_FILE_NAME)

    rmSync(absoluteDataDir, { recursive: true, force: true })
    mkdirSync(absoluteDataDir, { recursive: true })

    const connection = createConnection(dbFilePath)
    connection.run(
      `INSERT INTO app_config_values (key, value, updatedAt)
       VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
      ['host', '', Date.now(), 'port', '-1', Date.now(), 'yjsPersistenceFlushMs', '0', Date.now()]
    )
    connection.close()

    const manager = new ConfigManager(
      {
        NODE_ENV: 'test',
        PLOTLINE_DATA_DIR: dataDir,
      },
      {
        storeProvider: createDefaultConfigStore,
      }
    )

    const state = manager.getState()

    expect(state.config.server.host).toBe(DEFAULT_PERSISTED_CONFIG.host)
    expect(state.config.server.port).toBe(DEFAULT_PERSISTED_CONFIG.port)
    expect(state.config.yjs.persistenceFlushIntervalMs).toBe(
      DEFAULT_PERSISTED_CONFIG.yjsPersistenceFlushMs
    )
    expect(state.sources.host).toBe('default')
    expect(state.sources.port).toBe('default')
    expect(state.sources.yjsPersistenceFlushMs).toBe('default')
    expect(state.persistedConfig.host).toBeUndefined()
    expect(state.persistedConfig.port).toBeUndefined()
    expect(state.persistedConfig.yjsPersistenceFlushMs).toBeUndefined()

    manager.resetForTests()
    rmSync(absoluteDataDir, { recursive: true, force: true })
  })

  test('uses test-scoped data directory instead of inherited app data directory', () => {
    const safeDataDir = uniqueDataDir('config-manager-test-safety')
    const absoluteSafeDataDir = resolveDataDir(safeDataDir)

    rmSync(absoluteSafeDataDir, { recursive: true, force: true })

    const manager = new ConfigManager(
      {
        NODE_ENV: 'test',
        PLOTLINE_DATA_DIR: './data',
        PLOTLINE_TEST_DATA_DIR: safeDataDir,
      },
      {
        storeProvider: createDefaultConfigStore,
      }
    )

    const config = manager.getConfig()

    expect(config.paths.dataDir).toBe(absoluteSafeDataDir)
    expect(config.paths.dataDir).not.toBe(resolveDataDir('./data'))

    manager.resetForTests()
    rmSync(absoluteSafeDataDir, { recursive: true, force: true })
  })

  test('falls back to data-test when test runtime points to main data directory', () => {
    const manager = new ConfigManager(
      {
        NODE_ENV: 'test',
        PLOTLINE_DATA_DIR: './data',
      },
      {
        storeProvider: createDefaultConfigStore,
      }
    )

    const config = manager.getConfig()
    expect(config.paths.dataDir).toBe(resolveDataDir('data-test'))
    expect(config.paths.dataDir).not.toBe(resolveDataDir('./data'))

    manager.resetForTests()
    rmSync(resolveDataDir('data-test'), { recursive: true, force: true })
  })

  test('treats explicit test mode as test runtime even when NODE_ENV is not test', () => {
    const safeDataDir = uniqueDataDir('config-manager-explicit-test-mode')
    const absoluteSafeDataDir = resolveDataDir(safeDataDir)
    rmSync(absoluteSafeDataDir, { recursive: true, force: true })

    const manager = new ConfigManager(
      {
        NODE_ENV: 'development',
        PLOTLINE_TEST_MODE: '1',
        PLOTLINE_DATA_DIR: './data',
        PLOTLINE_TEST_DATA_DIR: safeDataDir,
      },
      {
        storeProvider: createDefaultConfigStore,
      }
    )

    const config = manager.getConfig()
    expect(config.paths.dataDir).toBe(absoluteSafeDataDir)
    expect(config.paths.dataDir).not.toBe(resolveDataDir('./data'))

    manager.resetForTests()
    rmSync(absoluteSafeDataDir, { recursive: true, force: true })
  })
})
