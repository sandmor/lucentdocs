import type { AiModelSelectionScopeType, AiProviderSelectionUsage } from '@lucentdocs/shared'
import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  AiModelSelectionEntity,
  AiModelSelectionRepositoryPort,
  UpsertAiModelSelectionInput,
} from '../../core/ports/aiModelSelection.port.js'
import { currentTxId } from './tx-scope.js'
import { aiModelSelectionFromDto, upsertAiModelSelectionToDto } from './mappers.js'

export class AiModelSelectionRepository implements AiModelSelectionRepositoryPort {
  constructor(private readonly engine: NativeStorageEngine) {}

  async get(
    usage: AiProviderSelectionUsage,
    scopeType: AiModelSelectionScopeType,
    scopeId: string
  ): Promise<AiModelSelectionEntity | undefined> {
    const row = await this.engine.aiModelSelectionGet(currentTxId(), usage, scopeType, scopeId)
    return row ? aiModelSelectionFromDto(row) : undefined
  }

  async getMany(
    usage: AiProviderSelectionUsage,
    scopeType: AiModelSelectionScopeType,
    scopeIds: string[]
  ): Promise<AiModelSelectionEntity[]> {
    const rows = await this.engine.aiModelSelectionGetMany(
      currentTxId(),
      usage,
      scopeType,
      scopeIds
    )
    return rows.map(aiModelSelectionFromDto)
  }

  async upsert(input: UpsertAiModelSelectionInput): Promise<AiModelSelectionEntity> {
    const row = await this.engine.aiModelSelectionUpsert(
      currentTxId(),
      upsertAiModelSelectionToDto(input)
    )
    return aiModelSelectionFromDto(row)
  }

  async delete(
    usage: AiProviderSelectionUsage,
    scopeType: AiModelSelectionScopeType,
    scopeId: string
  ): Promise<void> {
    await this.engine.aiModelSelectionDelete(currentTxId(), usage, scopeType, scopeId)
  }
}
