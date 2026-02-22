import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { CONFIG_FILE_NAME, resolveDataDir, resolveDataFile } from '../paths.js'
import { ConfigManager } from './manager.js'

function uniqueDataDir(label: string): string {
  return `data-test/${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

describe('ConfigManager', () => {
  test('merges env over file over defaults and persists canonical TOML', () => {
    const dataDir = uniqueDataDir('config-manager-priority')
    const absoluteDataDir = resolveDataDir(dataDir)
    const configFile = resolveDataFile(dataDir, CONFIG_FILE_NAME)

    rmSync(absoluteDataDir, { recursive: true, force: true })
    mkdirSync(absoluteDataDir, { recursive: true })

    writeFileSync(
      configFile,
      [
        '[server]',
        'host = "0.0.0.0"',
        'port = 6000',
        '',
        '[ai]',
        'base_url = "https://api.openai.com/v1"',
        'model = "gpt-4o-mini"',
        '',
        '[yjs]',
        'persistence_flush_interval_ms = 3333',
      ].join('\n')
    )

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
    expect(config.ai.model).toBe('claude-3-5-haiku-latest')
    expect(config.ai.baseURL).toBe('https://api.anthropic.com/v1')

    expect(config.yjs.persistenceFlushIntervalMs).toBe(3333)
    expect(config.yjs.versionSnapshotIntervalMs).toBe(9000)

    expect(existsSync(config.paths.configFile)).toBe(true)
    const persisted = readFileSync(config.paths.configFile, 'utf8')
    expect(persisted).toContain('[server]')
    expect(persisted).toContain('host = "127.0.0.9"')
    expect(persisted).toContain('port = 1234')
    expect(persisted).toContain('[ai]')
    expect(persisted).toContain('base_url = "https://api.anthropic.com/v1"')
    expect(persisted).toContain('[yjs]')
    expect(persisted).toContain('persistence_flush_interval_ms = 3333')
    expect(persisted).toContain('version_snapshot_interval_ms = 9000')

    rmSync(absoluteDataDir, { recursive: true, force: true })
  })

  test('returns a stable config object across repeated reads', async () => {
    const dataDir = uniqueDataDir('config-manager-stable')
    const absoluteDataDir = resolveDataDir(dataDir)
    rmSync(absoluteDataDir, { recursive: true, force: true })

    const manager = new ConfigManager({
      NODE_ENV: 'test',
      PLOTLINE_DATA_DIR: dataDir,
      PORT: '4242',
    })

    const reads = await Promise.all(
      Array.from({ length: 20 }, async () => {
        await Promise.resolve()
        return manager.getConfig()
      })
    )

    expect(reads.every((entry) => entry === reads[0])).toBe(true)
    expect(reads[0].server.port).toBe(4242)
    expect(reads[0].paths.configFile).toBe(resolveDataFile(dataDir, CONFIG_FILE_NAME))

    rmSync(absoluteDataDir, { recursive: true, force: true })
  })
})
