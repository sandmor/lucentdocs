import { indexingStrategySchema, type IndexingStrategyScopeType } from '@lucentdocs/shared'
import type {
  IndexingSettingsEntity,
  IndexingSettingsRepositoryPort,
  UpsertIndexingSettingsInput,
} from '../../core/ports/indexingSettings.port.js'
import type { SqliteConnection } from './connection.js'
import { fromJsonField, toJsonField } from './utils.js'

interface IndexingSettingsRow {
  scopeType: IndexingStrategyScopeType
  scopeId: string
  strategyType: string
  strategyProperties: string | null
  updatedAt: number
}

function toEntity(row: IndexingSettingsRow): IndexingSettingsEntity {
  return {
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    strategy: indexingStrategySchema.parse({
      type: row.strategyType,
      properties: fromJsonField(row.strategyProperties) ?? {},
    }),
    updatedAt: row.updatedAt,
  }
}

export class IndexingSettingsRepository implements IndexingSettingsRepositoryPort {
  constructor(private readonly connection: SqliteConnection) {}

  async get(
    scopeType: IndexingStrategyScopeType,
    scopeId: string
  ): Promise<IndexingSettingsEntity | undefined> {
    const row = this.connection.get<IndexingSettingsRow>(
      `SELECT scopeType, scopeId, strategyType, strategyProperties, updatedAt
         FROM indexing_strategy_settings
        WHERE scopeType = ? AND scopeId = ?`,
      [scopeType, scopeId]
    )

    return row ? toEntity(row) : undefined
  }

  async upsert(input: UpsertIndexingSettingsInput): Promise<IndexingSettingsEntity> {
    this.connection.run(
      `INSERT INTO indexing_strategy_settings
         (scopeType, scopeId, strategyType, strategyProperties, updatedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(scopeType, scopeId) DO UPDATE SET
         strategyType = excluded.strategyType,
         strategyProperties = excluded.strategyProperties,
         updatedAt = excluded.updatedAt`,
      [
        input.scopeType,
        input.scopeId,
        input.strategy.type,
        toJsonField(input.strategy.properties),
        input.updatedAt,
      ]
    )

    const entity = await this.get(input.scopeType, input.scopeId)
    if (!entity) {
      throw new Error('Failed to read stored indexing settings.')
    }
    return entity
  }

  async delete(scopeType: IndexingStrategyScopeType, scopeId: string): Promise<void> {
    this.connection.run(
      'DELETE FROM indexing_strategy_settings WHERE scopeType = ? AND scopeId = ?',
      [scopeType, scopeId]
    )
  }
}
