import type { PersistedAppConfig } from '@plotline/shared'

export interface AppConfigRepositoryPort {
  isEmpty(): boolean
  readAll(): Partial<PersistedAppConfig>
  upsertMany(values: Partial<PersistedAppConfig>, updatedAt: number): void
}
