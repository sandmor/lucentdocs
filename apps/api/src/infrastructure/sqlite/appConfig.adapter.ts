import {
  CONFIG_FIELD_BY_KEY,
  PERSISTED_CONFIG_KEYS,
  type PersistedAppConfig,
  type PersistedConfigKey,
} from '@plotline/shared'
import type { AppConfigRepositoryPort } from '../../core/ports/appConfig.port.js'
import type { SqliteConnection } from './connection.js'

type PersistedConfigValue = PersistedAppConfig[PersistedConfigKey]

interface ConfigRow {
  key: string
  value: string
}

const persistedConfigKeySet = new Set<string>(PERSISTED_CONFIG_KEYS)

function parseStoredValue(
  key: PersistedConfigKey,
  rawValue: string
): PersistedConfigValue | undefined {
  const field = CONFIG_FIELD_BY_KEY[key]

  if (field.kind === 'string') {
    return rawValue
  }

  if (field.kind === 'boolean') {
    if (rawValue === '1' || rawValue.toLowerCase() === 'true') return true
    if (rawValue === '0' || rawValue.toLowerCase() === 'false') return false
    return undefined
  }

  if (field.kind === 'float') {
    const parsed = Number.parseFloat(rawValue)
    if (!Number.isFinite(parsed)) return undefined
    return parsed
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isInteger(parsed)) return undefined
  return parsed
}

function serializeStoredValue(key: PersistedConfigKey, value: PersistedConfigValue): string {
  const field = CONFIG_FIELD_BY_KEY[key]

  if (field.kind === 'boolean') {
    return value ? '1' : '0'
  }

  return String(value)
}

export class SqliteAppConfigRepository implements AppConfigRepositoryPort {
  private connection: SqliteConnection

  constructor(connection: SqliteConnection) {
    this.connection = connection
  }

  isEmpty(): boolean {
    const row = this.connection.get<{ key: string }>(
      'SELECT key FROM app_config_values LIMIT 1',
      []
    )
    return row == null
  }

  readAll(): Partial<PersistedAppConfig> {
    const rows = this.connection.all<ConfigRow>('SELECT key, value FROM app_config_values', [])
    const persisted = {} as Partial<PersistedAppConfig>
    const persistedRecord = persisted as Partial<Record<PersistedConfigKey, PersistedConfigValue>>

    for (const row of rows) {
      if (!persistedConfigKeySet.has(row.key)) {
        continue
      }

      const key = row.key as PersistedConfigKey
      const parsedValue = parseStoredValue(key, row.value)
      if (parsedValue === undefined) {
        continue
      }

      persistedRecord[key] = parsedValue
    }

    return persisted
  }

  upsertMany(values: Partial<PersistedAppConfig>, updatedAt: number): void {
    const entries = Object.entries(values).filter((entry) => entry[1] !== undefined)

    if (entries.length === 0) {
      return
    }

    this.connection.transaction(() => {
      for (const [rawKey, rawValue] of entries) {
        const key = rawKey as PersistedConfigKey
        const value = rawValue as PersistedConfigValue

        this.connection.run(
          `INSERT INTO app_config_values (key, value, updatedAt)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
          [key, serializeStoredValue(key, value), updatedAt]
        )
      }
    })
  }
}
