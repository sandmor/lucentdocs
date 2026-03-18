import type { DocumentEmbeddingMetadataStorePort } from '../../core/ports/documentEmbeddingMetadata.port.js'
import { createSqliteAdapter, type SqliteAdapter } from '../sqlite/factory.js'
import { readTrimmedEnvValue } from '../../config/env.js'

export type PrimaryDatabaseKind = 'sqlite' | 'postgres'

export interface PrimaryDatabaseConfig {
  kind: PrimaryDatabaseKind
}

export interface MainDatabaseAdapter extends SqliteAdapter {
  metadataStores: {
    documentEmbeddings: DocumentEmbeddingMetadataStorePort
  }
}

export function resolvePrimaryDatabaseConfig(env: NodeJS.ProcessEnv): PrimaryDatabaseConfig {
  const raw = readTrimmedEnvValue(env, 'MAIN_DB')
  if (!raw) return { kind: 'sqlite' }

  const normalized = raw.toLowerCase()
  if (normalized === 'sqlite') return { kind: 'sqlite' }
  if (normalized === 'postgres' || normalized === 'postgresql') return { kind: 'postgres' }

  throw new Error(`Unsupported MAIN_DB value: ${raw}`)
}

export function createMainDatabaseAdapter(
  dbPath: string,
  config: PrimaryDatabaseConfig
): MainDatabaseAdapter {
  if (config.kind === 'sqlite') {
    return createSqliteAdapter(dbPath)
  }

  throw new Error('MAIN_DB=postgres is not implemented yet.')
}
