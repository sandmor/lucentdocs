import type {
  AiApiKeyEntity,
  AiProviderConfigEntity,
  AiRuntimeSettingsEntity,
  AiSettingsRepositoryPort,
  UpdateAiApiKeyData,
  UpsertAiProviderConfigInput,
} from '../../core/ports/aiSettings.port.js'
import { normalizeModelSourceType } from '../../core/ai/provider-types.js'
import type { SqliteConnection } from './connection.js'

interface ProviderRow {
  id: string
  providerId: string
  type: string
  baseUrl: string
  model: string
  apiKeyId: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
}

interface ApiKeyRow {
  id: string
  baseUrl: string
  name: string
  apiKey: string
  isDefault: number
  createdAt: number
  updatedAt: number
}

interface RuntimeRow {
  activeProviderId: string | null
  updatedAt: number
}

function fromProviderRow(row: ProviderRow): AiProviderConfigEntity {
  return {
    id: row.id,
    providerId: row.providerId,
    type: normalizeModelSourceType(row.type),
    baseURL: row.baseUrl,
    model: row.model,
    apiKeyId: row.apiKeyId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function fromApiKeyRow(row: ApiKeyRow): AiApiKeyEntity {
  return {
    id: row.id,
    baseURL: row.baseUrl,
    name: row.name,
    apiKey: row.apiKey,
    isDefault: row.isDefault === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class AiSettingsRepository implements AiSettingsRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  async listProviderConfigs(): Promise<AiProviderConfigEntity[]> {
    const rows = this.connection.all<ProviderRow>(
      `SELECT id, providerId, type, baseUrl, model, apiKeyId, sortOrder, createdAt, updatedAt
       FROM ai_provider_configs
       ORDER BY sortOrder ASC, createdAt ASC`,
      []
    )
    return rows.map(fromProviderRow)
  }

  async upsertProviderConfig(input: UpsertAiProviderConfigInput): Promise<void> {
    this.connection.run(
      `INSERT INTO ai_provider_configs
        (id, providerId, type, baseUrl, model, apiKeyId, sortOrder, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         providerId = excluded.providerId,
         type = excluded.type,
         baseUrl = excluded.baseUrl,
         model = excluded.model,
         apiKeyId = excluded.apiKeyId,
         sortOrder = excluded.sortOrder,
         updatedAt = excluded.updatedAt`,
      [
        input.id,
        input.providerId,
        input.type,
        input.baseURL,
        input.model,
        input.apiKeyId,
        input.sortOrder,
        input.createdAt,
        input.updatedAt,
      ]
    )
  }

  async deleteProviderConfigsNotIn(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      this.connection.run('DELETE FROM ai_provider_configs', [])
      return
    }

    const placeholders = ids.map(() => '?').join(', ')
    this.connection.run(`DELETE FROM ai_provider_configs WHERE id NOT IN (${placeholders})`, ids)
  }

  async readRuntimeSettings(): Promise<AiRuntimeSettingsEntity | undefined> {
    const row = this.connection.get<RuntimeRow>(
      'SELECT activeProviderId, updatedAt FROM ai_runtime_settings WHERE id = 1',
      []
    )
    return row
      ? {
          activeProviderId: row.activeProviderId,
          updatedAt: row.updatedAt,
        }
      : undefined
  }

  async upsertRuntimeSettings(activeProviderId: string | null, updatedAt: number): Promise<void> {
    this.connection.run(
      `INSERT INTO ai_runtime_settings (id, activeProviderId, updatedAt)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET activeProviderId = excluded.activeProviderId, updatedAt = excluded.updatedAt`,
      [activeProviderId, updatedAt]
    )
  }

  async listApiKeys(): Promise<AiApiKeyEntity[]> {
    const rows = this.connection.all<ApiKeyRow>(
      `SELECT id, baseUrl, name, apiKey, isDefault, createdAt, updatedAt
       FROM ai_api_keys
       ORDER BY baseUrl ASC, isDefault DESC, updatedAt DESC`,
      []
    )
    return rows.map(fromApiKeyRow)
  }

  async findApiKeyById(id: string): Promise<AiApiKeyEntity | undefined> {
    const row = this.connection.get<ApiKeyRow>(
      `SELECT id, baseUrl, name, apiKey, isDefault, createdAt, updatedAt
       FROM ai_api_keys
       WHERE id = ?`,
      [id]
    )
    return row ? fromApiKeyRow(row) : undefined
  }

  async clearDefaultApiKeys(baseURL: string, updatedAt: number): Promise<void> {
    this.connection.run('UPDATE ai_api_keys SET isDefault = 0, updatedAt = ? WHERE baseUrl = ?', [
      updatedAt,
      baseURL,
    ])
  }

  async insertApiKey(apiKey: AiApiKeyEntity): Promise<void> {
    this.connection.run(
      `INSERT INTO ai_api_keys (id, baseUrl, name, apiKey, isDefault, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        apiKey.id,
        apiKey.baseURL,
        apiKey.name,
        apiKey.apiKey,
        apiKey.isDefault ? 1 : 0,
        apiKey.createdAt,
        apiKey.updatedAt,
      ]
    )
  }

  async updateApiKey(id: string, data: UpdateAiApiKeyData): Promise<void> {
    this.connection.run(
      `UPDATE ai_api_keys
       SET name = ?,
           apiKey = ?,
           isDefault = ?,
           updatedAt = ?
       WHERE id = ?`,
      [data.name, data.apiKey, data.isDefault ? 1 : 0, data.updatedAt, id]
    )
  }

  async setApiKeyDefault(id: string, isDefault: boolean, updatedAt: number): Promise<void> {
    this.connection.run('UPDATE ai_api_keys SET isDefault = ?, updatedAt = ? WHERE id = ?', [
      isDefault ? 1 : 0,
      updatedAt,
      id,
    ])
  }

  async deleteApiKey(id: string): Promise<void> {
    this.connection.run('DELETE FROM ai_api_keys WHERE id = ?', [id])
  }

  async clearProviderApiKeyReferences(apiKeyId: string, updatedAt: number): Promise<void> {
    this.connection.run(
      'UPDATE ai_provider_configs SET apiKeyId = NULL, updatedAt = ? WHERE apiKeyId = ?',
      [updatedAt, apiKeyId]
    )
  }
}
