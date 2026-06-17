import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  AiApiKeyEntity,
  AiProviderConfigEntity,
  AiSettingsRepositoryPort,
  UpdateAiApiKeyData,
  UpsertAiProviderConfigInput,
} from '../../core/ports/aiSettings.port.js'
import type { AiProviderUsage } from '../../core/ai/provider-usage.js'
import { currentTxId } from './tx-scope.js'
import {
  aiApiKeyFromDto,
  aiApiKeyToDto,
  aiProviderConfigFromDto,
  updateAiApiKeyToDto,
  upsertAiProviderConfigToDto,
} from './mappers.js'

export class AiSettingsRepository implements AiSettingsRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async listProviderConfigs(usage: AiProviderUsage): Promise<AiProviderConfigEntity[]> {
    const rows = await this.engine.aiSettingsListProviderConfigs(currentTxId(), usage)
    return rows.map(aiProviderConfigFromDto)
  }

  async upsertProviderConfig(input: UpsertAiProviderConfigInput): Promise<void> {
    await this.engine.aiSettingsUpsertProviderConfig(
      currentTxId(),
      upsertAiProviderConfigToDto(input)
    )
  }

  async deleteProviderConfigsNotIn(usage: AiProviderUsage, ids: string[]): Promise<void> {
    await this.engine.aiSettingsDeleteProviderConfigsNotIn(currentTxId(), usage, ids)
  }

  async listApiKeys(): Promise<AiApiKeyEntity[]> {
    const rows = await this.engine.aiSettingsListApiKeys(currentTxId())
    return rows.map(aiApiKeyFromDto)
  }

  async findApiKeyById(id: string): Promise<AiApiKeyEntity | undefined> {
    const row = await this.engine.aiSettingsFindApiKeyById(currentTxId(), id)
    return row ? aiApiKeyFromDto(row) : undefined
  }

  async clearDefaultApiKeys(baseURL: string, updatedAt: number): Promise<void> {
    await this.engine.aiSettingsClearDefaultApiKeys(currentTxId(), baseURL, updatedAt)
  }

  async insertApiKey(apiKey: AiApiKeyEntity): Promise<void> {
    await this.engine.aiSettingsInsertApiKey(currentTxId(), aiApiKeyToDto(apiKey))
  }

  async updateApiKey(id: string, data: UpdateAiApiKeyData): Promise<void> {
    await this.engine.aiSettingsUpdateApiKey(currentTxId(), id, updateAiApiKeyToDto(data))
    await this.engine.aiSettingsSetApiKeyDefault(currentTxId(), id, data.isDefault, data.updatedAt)
  }

  async setApiKeyDefault(id: string, isDefault: boolean, updatedAt: number): Promise<void> {
    await this.engine.aiSettingsSetApiKeyDefault(currentTxId(), id, isDefault, updatedAt)
  }

  async deleteApiKey(id: string): Promise<void> {
    await this.engine.aiSettingsDeleteApiKey(currentTxId(), id)
  }

  async clearProviderApiKeyReferences(apiKeyId: string, updatedAt: number): Promise<void> {
    await this.engine.aiSettingsClearProviderApiKeyReferences(
      currentTxId(),
      apiKeyId,
      updatedAt
    )
  }
}
