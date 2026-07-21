import type { PersistedAppConfig } from '@lucentdocs/shared'

export interface AppConfigRepositoryPort {
  isEmpty(): boolean
  readAll(): Partial<PersistedAppConfig>
  upsertMany(values: Partial<PersistedAppConfig>, updatedAt: number): void
  readEntries(): Array<{ key: string; value: string }>
  upsertEntries(entries: Array<{ key: string; value: string }>, updatedAt: number): void
}
