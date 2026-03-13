import type { IndexingStrategy, IndexingStrategyScopeType } from '@lucentdocs/shared'

export interface IndexingSettingsEntity {
  scopeType: IndexingStrategyScopeType
  scopeId: string
  strategy: IndexingStrategy
  updatedAt: number
}

export interface UpsertIndexingSettingsInput {
  scopeType: IndexingStrategyScopeType
  scopeId: string
  strategy: IndexingStrategy
  updatedAt: number
}

export interface IndexingSettingsRepositoryPort {
  get(
    scopeType: IndexingStrategyScopeType,
    scopeId: string
  ): Promise<IndexingSettingsEntity | undefined>
  getMany(
    scopeType: IndexingStrategyScopeType,
    scopeIds: string[]
  ): Promise<IndexingSettingsEntity[]>
  upsert(input: UpsertIndexingSettingsInput): Promise<IndexingSettingsEntity>
  delete(scopeType: IndexingStrategyScopeType, scopeId: string): Promise<void>
}
