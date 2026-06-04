import type { AiModelSelectionScopeType, AiProviderSelectionUsage } from '@lucentdocs/shared'

export interface AiModelSelectionEntity {
  usage: AiProviderSelectionUsage
  scopeType: AiModelSelectionScopeType
  scopeId: string
  providerConfigId: string
  updatedAt: number
}

export interface UpsertAiModelSelectionInput {
  usage: AiProviderSelectionUsage
  scopeType: AiModelSelectionScopeType
  scopeId: string
  providerConfigId: string
  updatedAt: number
}

export interface AiModelSelectionRepositoryPort {
  get(
    usage: AiProviderSelectionUsage,
    scopeType: AiModelSelectionScopeType,
    scopeId: string
  ): Promise<AiModelSelectionEntity | undefined>
  getMany(
    usage: AiProviderSelectionUsage,
    scopeType: AiModelSelectionScopeType,
    scopeIds: string[]
  ): Promise<AiModelSelectionEntity[]>
  upsert(input: UpsertAiModelSelectionInput): Promise<AiModelSelectionEntity>
  delete(
    usage: AiProviderSelectionUsage,
    scopeType: AiModelSelectionScopeType,
    scopeId: string
  ): Promise<void>
}
