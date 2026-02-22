import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import TOML from '@iarna/toml'
import { CONFIG_FILE_NAME, resolveDataDir, resolveDataFile } from '../paths.js'
import { ConfigManager } from './manager.js'
import { DEFAULT_PERSISTED_CONFIG } from '@plotline/shared'

function uniqueDataDir(label: string): string {
  return `data-test/${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

describe('ConfigManager', () => {
  test('merges env over file over defaults while keeping persisted TOML file-scoped', () => {
    const dataDir = uniqueDataDir('config-manager-priority')
    const absoluteDataDir = resolveDataDir(dataDir)
    const configFile = resolveDataFile(dataDir, CONFIG_FILE_NAME)

    rmSync(absoluteDataDir, { recursive: true, force: true })
    mkdirSync(absoluteDataDir, { recursive: true })

    const initialToml = [
      '[server]',
      'host = "0.0.0.0"',
      'port = 6000',
      '',
      '[ai]',
      'base_url = "https://api.openai.com/v1"',
      'model = "gpt-5"',
      '',
      '[yjs]',
      'persistence_flush_interval_ms = 3333',
    ].join('\n')
    writeFileSync(configFile, initialToml)

    const manager = new ConfigManager({
      NODE_ENV: 'test',
      HOST: '127.0.0.9',
      PORT: '1234',
      PLOTLINE_DATA_DIR: dataDir,
      AI_API_KEY: '',
      AI_BASE_URL: 'https://api.anthropic.com/v1',
      AI_MODEL: '',
      YJS_VERSION_INTERVAL_MS: '9000',
    })

    const config = manager.getConfig()

    expect(config.runtime.nodeEnv).toBe('test')
    expect(config.server.host).toBe('127.0.0.9')
    expect(config.server.port).toBe(1234)
    expect(config.paths.dataDir).toBe(absoluteDataDir)

    expect(config.ai.provider).toBe('anthropic')
    expect(config.ai.baseURL).toBe('https://api.anthropic.com/v1')

    expect(config.yjs.persistenceFlushIntervalMs).toBe(3333)
    expect(config.yjs.versionSnapshotIntervalMs).toBe(9000)

    const persisted = readFileSync(config.paths.configFile, 'utf8')
    expect(persisted).toBe(initialToml)

    rmSync(absoluteDataDir, { recursive: true, force: true })
  })

  test('creates a default config.toml when missing', () => {
    const dataDir = uniqueDataDir('config-manager-default-file')
    const absoluteDataDir = resolveDataDir(dataDir)
    rmSync(absoluteDataDir, { recursive: true, force: true })

    const manager = new ConfigManager({
      NODE_ENV: 'test',
      PLOTLINE_DATA_DIR: dataDir,
    })

    const config = manager.getConfig()
    const persisted = readFileSync(config.paths.configFile, 'utf8')
    const parsed = TOML.parse(persisted) as {
      app?: { environment?: string }
      server?: { host?: string; port?: number }
    }

    expect(parsed.app?.environment).toBe(DEFAULT_PERSISTED_CONFIG.NODE_ENV)
    expect(parsed.server?.host).toBe(DEFAULT_PERSISTED_CONFIG.HOST)
    expect(parsed.server?.port).toBe(DEFAULT_PERSISTED_CONFIG.PORT)

    rmSync(absoluteDataDir, { recursive: true, force: true })
  })

  test('updates file config and reports env-overridden fields', () => {
    const dataDir = uniqueDataDir('config-manager-update')
    const absoluteDataDir = resolveDataDir(dataDir)

    rmSync(absoluteDataDir, { recursive: true, force: true })
    mkdirSync(absoluteDataDir, { recursive: true })

    const manager = new ConfigManager({
      NODE_ENV: 'test',
      PLOTLINE_DATA_DIR: dataDir,
      AI_MODEL: 'gpt-from-env',
      YJS_PERSISTENCE_FLUSH_MS: '2500',
    })

    const result = manager.updateFileConfig({
      AI_MODEL: 'gpt-from-file',
      YJS_PERSISTENCE_FLUSH_MS: 7777,
    })

    expect(result.changedFileKeys.sort()).toEqual(['AI_MODEL', 'YJS_PERSISTENCE_FLUSH_MS'])
    expect(result.changedEffectiveKeys).toEqual([])
    expect(result.overriddenChangedKeys.sort()).toEqual(['AI_MODEL', 'YJS_PERSISTENCE_FLUSH_MS'])
    expect(result.state.config.ai.model).toBe('gpt-from-env')
    expect(result.state.config.yjs.persistenceFlushIntervalMs).toBe(2500)

    const persisted = readFileSync(result.state.config.paths.configFile, 'utf8')
    const parsed = TOML.parse(persisted) as {
      ai?: { model?: string }
      yjs?: { persistence_flush_interval_ms?: number }
    }
    expect(parsed.ai?.model).toBe('gpt-from-file')
    expect(parsed.yjs?.persistence_flush_interval_ms).toBe(7777)

    rmSync(absoluteDataDir, { recursive: true, force: true })
  })

  test('ignores invalid file values and keeps source as default', () => {
    const dataDir = uniqueDataDir('config-manager-invalid-file-values')
    const absoluteDataDir = resolveDataDir(dataDir)
    const configFile = resolveDataFile(dataDir, CONFIG_FILE_NAME)

    rmSync(absoluteDataDir, { recursive: true, force: true })
    mkdirSync(absoluteDataDir, { recursive: true })

    writeFileSync(
      configFile,
      ['[server]', 'host = ""', 'port = -1', '', '[yjs]', 'persistence_flush_interval_ms = 0'].join(
        '\n'
      )
    )

    const manager = new ConfigManager({
      NODE_ENV: 'test',
      PLOTLINE_DATA_DIR: dataDir,
    })

    const state = manager.getState()

    expect(state.config.server.host).toBe(DEFAULT_PERSISTED_CONFIG.HOST)
    expect(state.config.server.port).toBe(DEFAULT_PERSISTED_CONFIG.PORT)
    expect(state.config.yjs.persistenceFlushIntervalMs).toBe(
      DEFAULT_PERSISTED_CONFIG.YJS_PERSISTENCE_FLUSH_MS
    )
    expect(state.sources.HOST).toBe('default')
    expect(state.sources.PORT).toBe('default')
    expect(state.sources.YJS_PERSISTENCE_FLUSH_MS).toBe('default')
    expect(state.fileConfig.HOST).toBeUndefined()
    expect(state.fileConfig.PORT).toBeUndefined()
    expect(state.fileConfig.YJS_PERSISTENCE_FLUSH_MS).toBeUndefined()

    rmSync(absoluteDataDir, { recursive: true, force: true })
  })
})
