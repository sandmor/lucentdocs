import type { AiModelSourceType } from '@lucentdocs/shared'

export interface AiProviderConfigEntity {
  id: string
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
  activeProviderId: string | null
  updatedAt: number
}

export interface UpsertAiProviderConfigInput {
  id: string
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
  listProviderConfigs(): Promise<AiProviderConfigEntity[]>
  upsertProviderConfig(input: UpsertAiProviderConfigInput): Promise<void>
  deleteProviderConfigsNotIn(ids: string[]): Promise<void>
  readRuntimeSettings(): Promise<AiRuntimeSettingsEntity | undefined>
  upsertRuntimeSettings(activeProviderId: string | null, updatedAt: number): Promise<void>
  listApiKeys(): Promise<AiApiKeyEntity[]>
  findApiKeyById(id: string): Promise<AiApiKeyEntity | undefined>
  clearDefaultApiKeys(baseURL: string, updatedAt: number): Promise<void>
  insertApiKey(apiKey: AiApiKeyEntity): Promise<void>
  updateApiKey(id: string, data: UpdateAiApiKeyData): Promise<void>
  setApiKeyDefault(id: string, isDefault: boolean, updatedAt: number): Promise<void>
  deleteApiKey(id: string): Promise<void>
  clearProviderApiKeyReferences(apiKeyId: string, updatedAt: number): Promise<void>
}
