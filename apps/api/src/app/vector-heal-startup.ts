import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  QdrantRuntimeConfig,
  VectorStorageConfig,
} from '../infrastructure/vector/vector-storage.js'
import type { DocumentsService } from '../core/services/documents.service.js'
import type { EmbeddingIndexService } from '../core/services/embeddingIndex.service.js'
import { normalizeQdrantCollectionPrefix } from '../core/embeddings/documentEmbeddings.shared.js'

const VECTOR_STORAGE_FINGERPRINT_KEY = 'vector_storage_fingerprint'

interface VectorHealStartupInput {
  engine: NativeStorageEngine
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

async function readStoredFingerprint(engine: NativeStorageEngine): Promise<string | undefined> {
  const entries = await engine.appConfigReadAll(null)
  const row = entries.find((entry) => entry.key === VECTOR_STORAGE_FINGERPRINT_KEY)
  const value = row?.value?.trim()
  return value && value.length > 0 ? value : undefined
}

async function writeStoredFingerprint(engine: NativeStorageEngine, fingerprint: string): Promise<void> {
  const now = Date.now()
  await engine.appConfigUpsertMany(
    null,
    [{ key: VECTOR_STORAGE_FINGERPRINT_KEY, value: fingerprint }],
    now
  )
}

export async function scheduleVectorHealOnBackendChange(input: VectorHealStartupInput): Promise<{
  scheduled: boolean
  reason: 'unchanged' | 'switched'
  enqueuedDocumentCount: number
}> {
  const nextFingerprint = vectorStorageFingerprint(input.vectorStorage, input.qdrantConfig)
  const previousFingerprint = await readStoredFingerprint(input.engine)

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

  await writeStoredFingerprint(input.engine, nextFingerprint)

  return {
    scheduled: true,
    reason: 'switched',
    enqueuedDocumentCount,
  }
}
