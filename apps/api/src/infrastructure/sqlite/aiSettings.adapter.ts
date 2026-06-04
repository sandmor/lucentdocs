import type {
  AiApiKeyEntity,
  AiProviderConfigEntity,
  AiSettingsRepositoryPort,
  UpdateAiApiKeyData,
  UpsertAiProviderConfigInput,
} from '../../core/ports/aiSettings.port.js'
import { normalizeModelSourceType } from '../../core/ai/provider-types.js'
import { normalizeCustomHeaders } from '@lucentdocs/shared'
import type { AiProviderUsage } from '../../core/ai/provider-usage.js'
import type { SqliteConnection } from './connection.js'

interface ProviderRow {
  id: string
  usage: AiProviderUsage
  name: string | null
  providerId: string
  type: string
  baseUrl: string
  model: string
  apiKeyId: string | null
  customHeaders: string
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

function fromProviderRow(row: ProviderRow): AiProviderConfigEntity {
  return {
    id: row.id,
    usage: row.usage,
    name: row.name,
    providerId: row.providerId,
    type: normalizeModelSourceType(row.type),
    baseURL: row.baseUrl,
    model: row.model,
    apiKeyId: row.apiKeyId,
    customHeaders: normalizeCustomHeaders(row.customHeaders),
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

  async listProviderConfigs(usage: AiProviderUsage): Promise<AiProviderConfigEntity[]> {
    const rows = this.connection.all<ProviderRow>(
      `SELECT id, usage, name, providerId, type, baseUrl, model, apiKeyId, customHeaders, sortOrder, createdAt, updatedAt
       FROM ai_provider_configs
       WHERE usage = ?
       ORDER BY sortOrder ASC, createdAt ASC`,
      [usage]
    )
    return rows.map(fromProviderRow)
  }

  async upsertProviderConfig(input: UpsertAiProviderConfigInput): Promise<void> {
    this.connection.run(
      `INSERT INTO ai_provider_configs
        (id, usage, name, providerId, type, baseUrl, model, apiKeyId, customHeaders, sortOrder, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         usage = excluded.usage,
         name = excluded.name,
         providerId = excluded.providerId,
         type = excluded.type,
         baseUrl = excluded.baseUrl,
         model = excluded.model,
         apiKeyId = excluded.apiKeyId,
         customHeaders = excluded.customHeaders,
         sortOrder = excluded.sortOrder,
         updatedAt = excluded.updatedAt`,
      [
        input.id,
        input.usage,
        input.name,
        input.providerId,
        input.type,
        input.baseURL,
        input.model,
        input.apiKeyId,
        JSON.stringify(input.customHeaders),
        input.sortOrder,
        input.createdAt,
        input.updatedAt,
      ]
    )
  }

  async deleteProviderConfigsNotIn(usage: AiProviderUsage, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      this.connection.run('DELETE FROM ai_provider_configs WHERE usage = ?', [usage])
      return
    }

    this.connection.run(
      `DELETE FROM ai_provider_configs AS cfg
        WHERE cfg.usage = ?
          AND NOT EXISTS (
            SELECT 1
              FROM json_each(?) AS requested
             WHERE requested.value = cfg.id
          )`,
      [usage, JSON.stringify(ids)]
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
