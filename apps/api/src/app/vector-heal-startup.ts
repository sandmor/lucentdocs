import type { SqliteConnection } from '../infrastructure/sqlite/connection.js'
import type {
  QdrantRuntimeConfig,
  VectorStorageConfig,
} from '../infrastructure/vector/vector-storage.js'
import type { DocumentsService } from '../core/services/documents.service.js'
import type { EmbeddingIndexService } from '../core/services/embeddingIndex.service.js'
import { normalizeQdrantCollectionPrefix } from '../core/embeddings/documentEmbeddings.shared.js'

const VECTOR_STORAGE_FINGERPRINT_KEY = 'vector_storage_fingerprint'

interface VectorHealStartupInput {
  connection: SqliteConnection
  vectorStorage: VectorStorageConfig
  qdrantConfig?: QdrantRuntimeConfig
  documents: DocumentsService
  embeddingIndex: EmbeddingIndexService
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '')
}

function vectorStorageFingerprint(
  vectorStorage: VectorStorageConfig,
  qdrantConfig?: QdrantRuntimeConfig
): string {
  if (vectorStorage.kind === 'none') return 'none'

  if (!qdrantConfig) {
    throw new Error('Qdrant configuration is required when VECTOR_STORAGE=qdrant')
  }

  const normalizedPrefix = normalizeQdrantCollectionPrefix(qdrantConfig.collectionPrefix)
  if (!normalizedPrefix) {
    throw new Error('Qdrant collection prefix resolves to an empty value.')
  }

  return `qdrant:${normalizeEndpoint(qdrantConfig.endpoint)}:${normalizedPrefix}`
}

function readStoredFingerprint(connection: SqliteConnection): string | undefined {
  const row = connection.get<{ value: string }>(
    'SELECT value FROM app_config_values WHERE key = ?',
    [VECTOR_STORAGE_FINGERPRINT_KEY]
  )
  const value = row?.value?.trim()
  return value && value.length > 0 ? value : undefined
}

function writeStoredFingerprint(connection: SqliteConnection, fingerprint: string): void {
  const now = Date.now()
  connection.run(
    `INSERT INTO app_config_values (key, value, updatedAt)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
    [VECTOR_STORAGE_FINGERPRINT_KEY, fingerprint, now]
  )
}

export async function scheduleVectorHealOnBackendChange(input: VectorHealStartupInput): Promise<{
  scheduled: boolean
  reason: 'unchanged' | 'switched'
  enqueuedDocumentCount: number
}> {
  const nextFingerprint = vectorStorageFingerprint(input.vectorStorage, input.qdrantConfig)
  const previousFingerprint = readStoredFingerprint(input.connection)

  if (previousFingerprint === nextFingerprint) {
    return {
      scheduled: false,
      reason: 'unchanged',
      enqueuedDocumentCount: 0,
    }
  }

  let enqueuedDocumentCount = 0
  if (input.vectorStorage.kind === 'qdrant') {
    const documentIds = await input.documents.listAllIds()
    if (documentIds.length > 0) {
      await input.embeddingIndex.enqueueDocuments(documentIds, { debounceMs: 0 })
      enqueuedDocumentCount = documentIds.length
    }
  }

  writeStoredFingerprint(input.connection, nextFingerprint)

  return {
    scheduled: true,
    reason: 'switched',
    enqueuedDocumentCount,
  }
}
