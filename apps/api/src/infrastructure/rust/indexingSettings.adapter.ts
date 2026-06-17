import type { IndexingStrategyScopeType } from '@lucentdocs/shared'
import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  IndexingSettingsEntity,
  IndexingSettingsRepositoryPort,
  UpsertIndexingSettingsInput,
} from '../../core/ports/indexingSettings.port.js'
import { currentTxId } from './tx-scope.js'
import { indexingSettingsFromDto, upsertIndexingSettingsToDto } from './mappers.js'

export class IndexingSettingsRepository implements IndexingSettingsRepositoryPort {
  constructor(private readonly engine: NativeStorageEngine) {}

  async get(
    scopeType: IndexingStrategyScopeType,
    scopeId: string
  ): Promise<IndexingSettingsEntity | undefined> {
    const row = await this.engine.indexingSettingsGet(currentTxId(), scopeType, scopeId)
    return row ? indexingSettingsFromDto(row) : undefined
  }

  async getMany(
    scopeType: IndexingStrategyScopeType,
    scopeIds: string[]
  ): Promise<IndexingSettingsEntity[]> {
    const rows = await this.engine.indexingSettingsGetMany(currentTxId(), scopeType, scopeIds)
    return rows.map(indexingSettingsFromDto)
  }

  async upsert(input: UpsertIndexingSettingsInput): Promise<IndexingSettingsEntity> {
    const row = await this.engine.indexingSettingsUpsert(
      currentTxId(),
      upsertIndexingSettingsToDto(input)
    )
    return indexingSettingsFromDto(row)
  }

  async delete(scopeType: IndexingStrategyScopeType, scopeId: string): Promise<void> {
    await this.engine.indexingSettingsDelete(currentTxId(), scopeType, scopeId)
  }
}
