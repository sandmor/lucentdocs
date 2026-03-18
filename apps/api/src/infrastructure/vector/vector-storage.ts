import { readTrimmedEnvValue } from '../../config/env.js'

export type VectorStorageKind = 'none' | 'qdrant'

export interface VectorStorageConfig {
  kind: VectorStorageKind
}

export function resolveVectorStorageConfig(env: NodeJS.ProcessEnv): VectorStorageConfig {
  const raw = readTrimmedEnvValue(env, 'VECTOR_STORAGE')
  if (!raw) return { kind: 'none' }

  const normalized = raw.toLowerCase()
  if (normalized === 'none') return { kind: 'none' }
  if (normalized === 'qdrant') return { kind: 'qdrant' }

  throw new Error(`Unsupported VECTOR_STORAGE value: ${raw}`)
}

export interface QdrantRuntimeConfig {
  endpoint: string
  apiKey?: string
  collectionPrefix: string
  upsertBatchSize?: number
  upsertBatchConcurrency?: number
}

export function resolveQdrantRuntimeConfig(env: NodeJS.ProcessEnv): QdrantRuntimeConfig {
  const endpoint = readTrimmedEnvValue(env, 'QDRANT_URL') ?? 'http://127.0.0.1:6333'
  const apiKey = readTrimmedEnvValue(env, 'QDRANT_API_KEY')
  const collectionPrefix = readTrimmedEnvValue(env, 'QDRANT_COLLECTION_PREFIX') ?? 'lucentdocs'
  const rawBatchSize = readTrimmedEnvValue(env, 'QDRANT_UPSERT_BATCH_SIZE')
  const rawBatchConcurrency = readTrimmedEnvValue(env, 'QDRANT_UPSERT_BATCH_CONCURRENCY')

  let upsertBatchSize: number | undefined
  if (rawBatchSize !== undefined) {
    const parsed = Number.parseInt(rawBatchSize, 10)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Invalid QDRANT_UPSERT_BATCH_SIZE value: ${rawBatchSize}`)
    }
    upsertBatchSize = parsed
  }

  let upsertBatchConcurrency: number | undefined
  if (rawBatchConcurrency !== undefined) {
    const parsed = Number.parseInt(rawBatchConcurrency, 10)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Invalid QDRANT_UPSERT_BATCH_CONCURRENCY value: ${rawBatchConcurrency}`)
    }
    upsertBatchConcurrency = parsed
  }

  return {
    endpoint,
    apiKey,
    collectionPrefix,
    upsertBatchSize,
    upsertBatchConcurrency,
  }
}
