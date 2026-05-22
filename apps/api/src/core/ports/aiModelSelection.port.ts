import type { AiModelSelectionScopeType } from '@lucentdocs/shared'

export interface AiModelSelectionEntity {
  scopeType: AiModelSelectionScopeType
  scopeId: string
  providerConfigId: string
  updatedAt: number
}

export interface UpsertAiModelSelectionInput {
  scopeType: AiModelSelectionScopeType
  scopeId: string
  providerConfigId: string
  updatedAt: number
}

export interface AiModelSelectionRepositoryPort {
  get(
    scopeType: AiModelSelectionScopeType,
    scopeId: string
  ): Promise<AiModelSelectionEntity | undefined>
  getMany(
    scopeType: AiModelSelectionScopeType,
    scopeIds: string[]
  ): Promise<AiModelSelectionEntity[]>
  upsert(input: UpsertAiModelSelectionInput): Promise<AiModelSelectionEntity>
  delete(scopeType: AiModelSelectionScopeType, scopeId: string): Promise<void>
}
