import type { AiModelSelectionScopeType } from '@lucentdocs/shared'
import type {
  AiModelSelectionEntity,
  AiModelSelectionRepositoryPort,
  UpsertAiModelSelectionInput,
} from '../../core/ports/aiModelSelection.port.js'
import type { SqliteConnection } from './connection.js'

interface AiModelSelectionRow {
  scopeType: AiModelSelectionScopeType
  scopeId: string
  providerConfigId: string
  updatedAt: number
}

function toEntity(row: AiModelSelectionRow): AiModelSelectionEntity {
  return {
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    providerConfigId: row.providerConfigId,
    updatedAt: row.updatedAt,
  }
}

export class AiModelSelectionRepository implements AiModelSelectionRepositoryPort {
  constructor(private readonly connection: SqliteConnection) {}

  async get(
    scopeType: AiModelSelectionScopeType,
    scopeId: string
  ): Promise<AiModelSelectionEntity | undefined> {
    const row = this.connection.get<AiModelSelectionRow>(
      `SELECT scopeType, scopeId, providerConfigId, updatedAt
         FROM ai_model_selection_settings
        WHERE scopeType = ? AND scopeId = ?`,
      [scopeType, scopeId]
    )

    return row ? toEntity(row) : undefined
  }

  async getMany(
    scopeType: AiModelSelectionScopeType,
    scopeIds: string[]
  ): Promise<AiModelSelectionEntity[]> {
    const uniqueScopeIds = Array.from(new Set(scopeIds.filter((scopeId) => scopeId.length > 0)))
    if (uniqueScopeIds.length === 0) {
      return []
    }

    const rows = this.connection.all<AiModelSelectionRow>(
      `WITH requested AS (
         SELECT value AS scopeId
           FROM json_each(?)
       )
       SELECT s.scopeType, s.scopeId, s.providerConfigId, s.updatedAt
         FROM ai_model_selection_settings AS s
         JOIN requested ON requested.scopeId = s.scopeId
        WHERE s.scopeType = ?`,
      [JSON.stringify(uniqueScopeIds), scopeType]
    )

    return rows.map(toEntity)
  }

  async upsert(input: UpsertAiModelSelectionInput): Promise<AiModelSelectionEntity> {
    this.connection.run(
      `INSERT INTO ai_model_selection_settings
         (scopeType, scopeId, providerConfigId, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(scopeType, scopeId) DO UPDATE SET
         providerConfigId = excluded.providerConfigId,
         updatedAt = excluded.updatedAt`,
      [input.scopeType, input.scopeId, input.providerConfigId, input.updatedAt]
    )

    const entity = await this.get(input.scopeType, input.scopeId)
    if (!entity) {
      throw new Error('Failed to read stored AI model selection settings.')
    }
    return entity
  }

  async delete(scopeType: AiModelSelectionScopeType, scopeId: string): Promise<void> {
    this.connection.run(
      'DELETE FROM ai_model_selection_settings WHERE scopeType = ? AND scopeId = ?',
      [scopeType, scopeId]
    )
  }
}
