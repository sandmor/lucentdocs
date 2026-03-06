import type { AiModelSourceType } from '@lucentdocs/shared'
import type { AiProviderUsage } from '../ai/provider-usage.js'

export interface AiProviderConfigEntity {
  id: string
  usage: AiProviderUsage
  providerId: string
  type: AiModelSourceType
  baseURL: string
  model: string
  apiKeyId: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface AiApiKeyEntity {
  id: string
  baseURL: string
  name: string
  apiKey: string
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

export interface AiRuntimeSettingsEntity {
  activeGenerationProviderId: string | null
  activeEmbeddingProviderId: string | null
  updatedAt: number
}

export interface UpsertAiProviderConfigInput {
  id: string
  usage: AiProviderUsage
  providerId: string
  type: AiModelSourceType
  baseURL: string
  model: string
  apiKeyId: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface UpdateAiApiKeyData {
  name: string
  apiKey: string
  isDefault: boolean
  updatedAt: number
}

export interface AiSettingsRepositoryPort {
  listProviderConfigs(usage: AiProviderUsage): Promise<AiProviderConfigEntity[]>
  upsertProviderConfig(input: UpsertAiProviderConfigInput): Promise<void>
  deleteProviderConfigsNotIn(usage: AiProviderUsage, ids: string[]): Promise<void>
  readRuntimeSettings(): Promise<AiRuntimeSettingsEntity | undefined>
  upsertRuntimeSettings(input: {
    activeGenerationProviderId: string | null
    activeEmbeddingProviderId: string | null
    updatedAt: number
  }): Promise<void>
  listApiKeys(): Promise<AiApiKeyEntity[]>
  findApiKeyById(id: string): Promise<AiApiKeyEntity | undefined>
  clearDefaultApiKeys(baseURL: string, updatedAt: number): Promise<void>
  insertApiKey(apiKey: AiApiKeyEntity): Promise<void>
  updateApiKey(id: string, data: UpdateAiApiKeyData): Promise<void>
  setApiKeyDefault(id: string, isDefault: boolean, updatedAt: number): Promise<void>
  deleteApiKey(id: string): Promise<void>
  clearProviderApiKeyReferences(apiKeyId: string, updatedAt: number): Promise<void>
}
