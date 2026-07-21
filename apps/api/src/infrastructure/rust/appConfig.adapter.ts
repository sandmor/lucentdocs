import type { PersistedAppConfig } from '@lucentdocs/shared'
import type { NativeStorageEngine } from '@lucentdocs/core'
import type { AppConfigRepositoryPort } from '../../core/ports/appConfig.port.js'
import { appConfigFromEntries, appConfigToEntries } from './mappers.js'

export class RustAppConfigRepository implements AppConfigRepositoryPort {
  private readonly engine: NativeStorageEngine

  constructor(engine: NativeStorageEngine) {
    this.engine = engine
  }

  isEmpty(): boolean {
    return this.engine.appConfigIsEmptySync()
  }

  readAll(): Partial<PersistedAppConfig> {
    const entries = this.engine.appConfigReadAllSync()
    return appConfigFromEntries(entries)
  }

  upsertMany(values: Partial<PersistedAppConfig>, updatedAt: number): void {
    const entries = appConfigToEntries(values)
    if (entries.length === 0) {
      return
    }

    this.engine.appConfigUpsertManySync(null, entries, updatedAt)
  }

  readEntries(): Array<{ key: string; value: string }> {
    return this.engine.appConfigReadAllSync()
  }

  upsertEntries(entries: Array<{ key: string; value: string }>, updatedAt: number): void {
    if (entries.length) this.engine.appConfigUpsertManySync(null, entries, updatedAt)
  }
}
