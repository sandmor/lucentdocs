import { createHash } from 'node:crypto'
import { DEFAULT_PERSISTED_CONFIG, type IndexingStrategy } from '@lucentdocs/shared'
import type { RepositorySet } from '../ports/types.js'
import type { TransactionPort } from '../ports/transaction.port.js'
import type { JobQueuePort } from '../ports/jobQueue.port.js'
import type { AiSettingsService } from './aiSettings.service.js'
import type { IndexingSettingsService } from './indexingSettings.service.js'
import type { DocumentEmbeddingEntity } from '../ports/documentEmbeddings.port.js'
import type { DocumentEmbeddingVectorReference } from '../ports/documentEmbeddings.port.js'
import type {
  DocumentEmbeddingJobEntity,
  DocumentEmbeddingQueueStats,
} from '../ports/embeddingIndexQueue.port.js'
import { readDocumentContentSnapshot } from '../../embeddings/document-content.js'
import { prepareEmbeddingDocumentsNative } from '../../embeddings/native-preparation.js'
import { getEmbeddingProvider } from '../../embeddings/provider.js'
import { normalizeBaseURL } from '../ai/provider-types.js'
import { EMBEDDING_VECTOR_CLEANUP_JOB_TYPE } from '../jobs/job-types.js'
import type { EmbeddingVectorCleanupJobPayload } from '../jobs/embedding-vector-cleanup-job.js'

interface PreparedEmbeddingChunk {
  ordinal: number
  start: number
  end: number
  selectionFrom: number | null
  selectionTo: number | null
  estimatedTokens: number
  text: string
}

export interface EmbeddingIndexRuntimeConfig {
  debounceMs: number
  batchMaxWaitMs: number
  batchMaxTokens: number
  batchMaxInputs: number
}

export interface EmbeddingFlushResult {
  queued: number
  processed: number
  skipped: number
}

export interface EmbeddingIndexService {
  enqueueDocument(
    documentId: string,
    options?: { queuedAt?: number; debounceMs?: number }
  ): Promise<void>
  enqueueDocuments(
    documentIds: string[],
    options?: { queuedAt?: number; debounceMs?: number }
  ): Promise<void>
  deleteDocument(documentId: string): Promise<void>
  deleteDocuments(
    documentIds: string[],
    options?: { references?: DocumentEmbeddingVectorReference[] }
  ): Promise<void>
  processQueuedDocuments(
    requests: Array<{ documentId: string; expectedLastQueuedAt?: number }>,
    now?: number
  ): Promise<EmbeddingFlushResult>
  flushDueQueue(config: EmbeddingIndexRuntimeConfig, now?: number): Promise<EmbeddingFlushResult>
  getQueueStats(): Promise<DocumentEmbeddingQueueStats>
}

function hashEmbeddingText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function pickDueJobs(
  jobs: DocumentEmbeddingJobEntity[],
  config: EmbeddingIndexRuntimeConfig,
  now: number
): DocumentEmbeddingJobEntity[] {
  if (jobs.length === 0) return []

  const oldestQueuedAt = jobs[0]?.firstQueuedAt ?? now
  const batchWaitExceeded = now - oldestQueuedAt >= config.batchMaxWaitMs
  if (batchWaitExceeded) return jobs

  return jobs.filter((job) => job.debounceUntil <= now)
}

function isStoredEmbeddingSetCurrent(
  existing: DocumentEmbeddingEntity[],
  baseURL: string,
  contentHash: string,
  chunks: PreparedEmbeddingChunk[]
): boolean {
  if (chunks.length === 0) {
    return existing.length === 0
  }

  if (existing.length !== chunks.length) {
    return false
  }

  const normalizedBaseURL = normalizeBaseURL(baseURL)

  return existing.every((entry, index) => {
    const chunk = chunks[index]
    return (
      normalizeBaseURL(entry.baseURL) === normalizedBaseURL &&
      entry.contentHash === contentHash &&
      entry.chunkOrdinal === chunk?.ordinal &&
      entry.chunkStart === chunk?.start &&
      entry.chunkEnd === chunk?.end &&
      entry.selectionFrom === chunk?.selectionFrom &&
      entry.selectionTo === chunk?.selectionTo
    )
  })
}

function isDocumentDeletedDuringFlush(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const maybe = error as Error & { code?: string }
  if (maybe.code && maybe.code !== 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return false
  }
  return /FOREIGN KEY constraint failed/i.test(error.message)
}

export function createEmbeddingIndexService(
  repos: RepositorySet,
  transaction: TransactionPort,
  jobQueue: JobQueuePort,
  aiSettingsService: AiSettingsService,
  indexingSettingsService: IndexingSettingsService,
  configOptions: {
    getRuntimeConfig?: () => EmbeddingIndexRuntimeConfig
  } = {}
): EmbeddingIndexService {
  let activeFlush: Promise<EmbeddingFlushResult> | null = null
  let activeTargetedFlush: Promise<EmbeddingFlushResult> | null = null

  const DEFAULT_BATCH_MAX_TOKENS = DEFAULT_PERSISTED_CONFIG.embeddingBatchMaxTokens
  const DEFAULT_BATCH_MAX_INPUTS = DEFAULT_PERSISTED_CONFIG.embeddingBatchMaxInputs
  const DEFAULT_RUNTIME_CONFIG: EmbeddingIndexRuntimeConfig = {
    debounceMs: 0,
    batchMaxWaitMs: 0,
    batchMaxTokens: DEFAULT_BATCH_MAX_TOKENS,
    batchMaxInputs: DEFAULT_BATCH_MAX_INPUTS,
  }
  const EMBED_REPLACE_CONCURRENCY = 4
  const VECTOR_CLEANUP_JOB_MAX_REFERENCES = 500
  const VECTOR_CLEANUP_JOB_PRIORITY = 50

  const mapWithConcurrency = async <T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>
  ): Promise<R[]> => {
    if (items.length === 0) return []
    const normalizedConcurrency = Math.max(1, Math.min(concurrency, items.length))
    const results: R[] = new Array(items.length)
    let nextIndex = 0

    const runWorker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex
        nextIndex += 1
        if (index >= items.length) {
          return
        }
        results[index] = await worker(items[index] as T, index)
      }
    }

    await Promise.all(Array.from({ length: normalizedConcurrency }, () => runWorker()))
    return results
  }

  const embedDocumentsInPlannedBatches = async (
    provider: { embed: (inputs: string[]) => Promise<Array<{ embedding: number[] }>> },
    documents: Array<{ chunks: Array<{ text: string; estimatedTokens: number }> }>,
    context: { baseURL: string; model: string },
    limits: { maxTokens: number; maxInputs: number }
  ): Promise<Array<{ embedding: number[] }>> => {
    const result: Array<{ embedding: number[] }> = []
    let batch: string[] = []
    let batchTokens = 0

    const runEmbed = async (
      inputs: string[],
      estimatedTokens: number,
      mode: 'batch' | 'single-oversized'
    ): Promise<Array<{ embedding: number[] }>> => {
      try {
        return await provider.embed(inputs)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.warn('[embedding] Embedding request failed:', {
          baseURL: context.baseURL,
          model: context.model,
          inputs: inputs.length,
          estimatedTokens,
          maxTokens: limits.maxTokens,
          maxInputs: limits.maxInputs,
          mode,
          message: errorMessage,
        })
        throw error
      }
    }

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return
      const embeddings = await runEmbed(batch, batchTokens, 'batch')
      result.push(...embeddings)
      batch = []
      batchTokens = 0
    }

    for (const document of documents) {
      for (const chunk of document.chunks) {
        const estimatedTokens = Number.isFinite(chunk.estimatedTokens)
          ? Math.max(0, Math.floor(chunk.estimatedTokens))
          : 0

        if (
          batch.length > 0 &&
          (batchTokens + estimatedTokens > limits.maxTokens || batch.length >= limits.maxInputs)
        ) {
          await flush()
        }

        if (estimatedTokens > limits.maxTokens && batch.length === 0) {
          // Too large for the configured budget even as a single entry; still try to embed it alone.
          const embeddings = await runEmbed([chunk.text], estimatedTokens, 'single-oversized')
          result.push(...embeddings)
          continue
        }

        batch.push(chunk.text)
        batchTokens += estimatedTokens
      }
    }

    await flush()
    return result
  }

  const processJobs = async (
    jobsToProcess: DocumentEmbeddingJobEntity[],
    queuedCount: number,
    now: number,
    runtimeConfig: EmbeddingIndexRuntimeConfig
  ): Promise<EmbeddingFlushResult> => {
    if (jobsToProcess.length === 0) {
      return { queued: queuedCount, processed: 0, skipped: 0 }
    }

    const selection = await aiSettingsService.resolveRuntimeSelection('embedding')
    const provider = await getEmbeddingProvider()
    const documents = await repos.documents.findByIds(jobsToProcess.map((job) => job.documentId))
    const documentsById = new Map(documents.map((document) => [document.id, document]))
    const resolvedStrategies = await indexingSettingsService.resolveForDocuments(
      jobsToProcess.map((job) => job.documentId)
    )

    const documentsToEmbed: Array<{
      documentId: string
      contentHash: string
      documentTimestamp: number
      expectedLastQueuedAt: number
      chunks: PreparedEmbeddingChunk[]
      strategy: IndexingStrategy
    }> = []
    const candidatesToClear: Array<{ documentId: string; expectedLastQueuedAt: number }> = []
    let skipped = 0

    const nativePreparationRequests: Array<{
      documentId: string
      title: string
      content: string
      strategy: IndexingStrategy
    }> = []

    await Promise.all(
      jobsToProcess.map(async (job) => {
        const document = documentsById.get(job.documentId)
        if (!document) {
          candidatesToClear.push({
            documentId: job.documentId,
            expectedLastQueuedAt: job.lastQueuedAt,
          })
          return
        }

        const resolvedStrategy = resolvedStrategies.get(document.id)
        if (!resolvedStrategy) {
          candidatesToClear.push({
            documentId: document.id,
            expectedLastQueuedAt: job.lastQueuedAt,
          })
          return
        }

        const content = await readDocumentContentSnapshot(repos, document.id)
        nativePreparationRequests.push({
          documentId: document.id,
          title: document.title,
          content,
          strategy: resolvedStrategy.strategy,
        })
      })
    )

    const preparationFailuresByDocumentId = new Map<string, Error>()
    let preparedDocuments: Awaited<ReturnType<typeof prepareEmbeddingDocumentsNative>> = []
    try {
      preparedDocuments = await prepareEmbeddingDocumentsNative(nativePreparationRequests)
    } catch (batchError) {
      for (const request of nativePreparationRequests) {
        try {
          const prepared = await prepareEmbeddingDocumentsNative([request])
          preparedDocuments.push(...prepared)
        } catch (singleError) {
          preparationFailuresByDocumentId.set(
            request.documentId,
            singleError instanceof Error
              ? singleError
              : new Error(`Unknown native preparation error: ${String(singleError)}`)
          )
        }
      }

      if (preparationFailuresByDocumentId.size === 0) {
        throw batchError
      }
    }

    const preparedByDocumentId = new Map(
      preparedDocuments.map((prepared) => [prepared.documentId, prepared])
    )

    for (const job of jobsToProcess) {
      const document = documentsById.get(job.documentId)
      if (!document) {
        continue
      }

      const documentTimestamp = now
      const resolvedStrategy = resolvedStrategies.get(document.id)
      if (!resolvedStrategy) {
        continue
      }

      const prepared = preparedByDocumentId.get(document.id)
      if (!prepared) {
        if (preparationFailuresByDocumentId.has(document.id)) {
          candidatesToClear.push({
            documentId: document.id,
            expectedLastQueuedAt: job.lastQueuedAt,
          })
          skipped += 1
          continue
        }

        candidatesToClear.push({
          documentId: document.id,
          expectedLastQueuedAt: job.lastQueuedAt,
        })
        continue
      }

      const chunks = prepared.chunks

      const contentHash = hashEmbeddingText(
        JSON.stringify({
          strategy: resolvedStrategy.strategy,
          text: prepared.projectionText,
        })
      )
      const existing = await repos.documentEmbeddings.findEmbeddings(
        document.id,
        selection.baseURL,
        selection.model
      )

      if (isStoredEmbeddingSetCurrent(existing, selection.baseURL, contentHash, chunks)) {
        candidatesToClear.push({
          documentId: document.id,
          expectedLastQueuedAt: job.lastQueuedAt,
        })
        if (chunks.length > 0) {
          skipped += 1
        }
        continue
      }

      documentsToEmbed.push({
        documentId: document.id,
        contentHash,
        documentTimestamp,
        expectedLastQueuedAt: job.lastQueuedAt,
        chunks,
        strategy: resolvedStrategy.strategy,
      })
    }

    let processed = 0
    const queueIdsToClear = new Set<string>()

    if (documentsToEmbed.length > 0) {
      const maxTokens = Math.max(
        1,
        Math.floor(runtimeConfig.batchMaxTokens || DEFAULT_BATCH_MAX_TOKENS)
      )
      const maxInputs = Math.max(
        1,
        Math.floor(runtimeConfig.batchMaxInputs || DEFAULT_BATCH_MAX_INPUTS)
      )
      const embeddings = await embedDocumentsInPlannedBatches(
        provider,
        documentsToEmbed,
        {
          baseURL: selection.baseURL,
          model: selection.model,
        },
        { maxTokens, maxInputs }
      )

      const replacements: Array<{
        item: (typeof documentsToEmbed)[number]
        startOffset: number
      }> = []
      let embeddingOffset = 0
      for (const item of documentsToEmbed) {
        replacements.push({ item, startOffset: embeddingOffset })
        embeddingOffset += item.chunks.length
      }

      const replacementResults = await mapWithConcurrency(
        replacements,
        EMBED_REPLACE_CONCURRENCY,
        async ({ item, startOffset }) => {
          const currentJob = await repos.embeddingIndexQueue.getQueuedDocument(item.documentId)
          if (!currentJob || currentJob.lastQueuedAt !== item.expectedLastQueuedAt) {
            return {
              documentId: item.documentId,
              shouldClear: false,
              processedDelta: 0,
              skippedDelta: 0,
            }
          }

          const nextChunks = item.chunks.map((chunk, chunkIndex) => {
            const embedding = embeddings[startOffset + chunkIndex]?.embedding
            if (!embedding) {
              throw new Error(
                `Missing embedding vector for document ${item.documentId} chunk ${chunk.ordinal}.`
              )
            }

            return {
              ordinal: chunk.ordinal,
              start: chunk.start,
              end: chunk.end,
              selectionFrom: chunk.selectionFrom,
              selectionTo: chunk.selectionTo,
              text: chunk.text,
              vectorKey: `${item.documentId}:${normalizeBaseURL(selection.baseURL)}:${selection.model.trim()}:${chunk.ordinal}`,
              embedding,
            }
          })

          let replacement
          try {
            replacement = await repos.documentEmbeddings.replaceEmbeddings({
              documentId: item.documentId,
              providerConfigId: selection.providerConfigId,
              providerId: selection.providerId,
              type: selection.type,
              baseURL: selection.baseURL,
              model: selection.model,
              strategy: item.strategy,
              documentTimestamp: item.documentTimestamp,
              contentHash: item.contentHash,
              chunks: nextChunks,
              createdAt: now,
              updatedAt: now,
            })
          } catch (error) {
            if (isDocumentDeletedDuringFlush(error)) {
              const stillExists = await repos.documents.findById(item.documentId)
              if (stillExists) {
                throw error
              }

              return {
                documentId: item.documentId,
                shouldClear: true,
                processedDelta: 0,
                skippedDelta: 1,
              }
            }

            throw error
          }

          if (replacement.status === 'stale') {
            return {
              documentId: item.documentId,
              shouldClear: true,
              processedDelta: 0,
              skippedDelta: 1,
            }
          }

          return {
            documentId: item.documentId,
            shouldClear: true,
            processedDelta: item.chunks.length > 0 ? 1 : 0,
            skippedDelta: 0,
          }
        }
      )

      for (const result of replacementResults) {
        processed += result.processedDelta
        skipped += result.skippedDelta
        if (result.shouldClear) {
          queueIdsToClear.add(result.documentId)
        }
      }

      for (const candidate of candidatesToClear) {
        const currentJob = await repos.embeddingIndexQueue.getQueuedDocument(candidate.documentId)
        if (!currentJob || currentJob.lastQueuedAt !== candidate.expectedLastQueuedAt) {
          continue
        }
        queueIdsToClear.add(candidate.documentId)
      }

      if (queueIdsToClear.size > 0) {
        await transaction.run(async () => {
          await repos.embeddingIndexQueue.clearQueuedDocuments([...queueIdsToClear])
        })
      }
    } else if (candidatesToClear.length > 0) {
      await transaction.run(async () => {
        for (const candidate of candidatesToClear) {
          const currentJob = await repos.embeddingIndexQueue.getQueuedDocument(candidate.documentId)
          if (!currentJob || currentJob.lastQueuedAt !== candidate.expectedLastQueuedAt) {
            continue
          }
          queueIdsToClear.add(candidate.documentId)
        }

        if (queueIdsToClear.size > 0) {
          await repos.embeddingIndexQueue.clearQueuedDocuments([...queueIdsToClear])
        }
      })
    }

    return {
      queued: queuedCount,
      processed,
      skipped,
    }
  }

  return {
    async enqueueDocument(documentId, options = {}): Promise<void> {
      await this.enqueueDocuments([documentId], options)
    },

    async enqueueDocuments(documentIds, options = {}): Promise<void> {
      const uniqueIds = [...new Set(documentIds)].filter((id) => typeof id === 'string' && id)
      if (uniqueIds.length === 0) return

      const documents = await repos.documents.findByIds(uniqueIds)
      if (documents.length === 0) return

      const existingIds = documents.map((doc) => doc.id)
      const queuedAt = options.queuedAt ?? Date.now()
      const debounceMs = options.debounceMs ?? configOptions.getRuntimeConfig?.().debounceMs ?? 0
      await repos.embeddingIndexQueue.enqueueDocuments(existingIds, queuedAt, queuedAt + debounceMs)
    },

    async deleteDocument(documentId: string): Promise<void> {
      await this.deleteDocuments([documentId])
    },

    async deleteDocuments(
      documentIds: string[],
      options: { references?: DocumentEmbeddingVectorReference[] } = {}
    ): Promise<void> {
      const uniqueIds = [...new Set(documentIds)].filter((id) => typeof id === 'string' && id)
      if (uniqueIds.length === 0) return

      await repos.embeddingIndexQueue.clearQueuedDocuments(uniqueIds)

      // Eventual consistency note: external vector cleanup is asynchronous by design.
      // Callers should pass references captured in their successful DB transaction,
      // so jobs only run after the source-of-truth delete commits.
      const references =
        options.references ??
        (await repos.documentEmbeddings.listVectorReferencesByDocumentIds(uniqueIds))
      if (references.length === 0) return

      const dedupedReferences = [
        ...new Map(
          references
            .filter(
              (reference) =>
                reference.documentId &&
                reference.vectorKey &&
                Number.isInteger(reference.dimensions) &&
                reference.dimensions > 0 &&
                (reference.vectorRowId === undefined ||
                  (Number.isInteger(reference.vectorRowId) && reference.vectorRowId > 0))
            )
            .map((reference) => [
              `${reference.documentId}:${reference.vectorKey}:${reference.dimensions}`,
              reference,
            ])
        ).values(),
      ]

      for (
        let offset = 0;
        offset < dedupedReferences.length;
        offset += VECTOR_CLEANUP_JOB_MAX_REFERENCES
      ) {
        const payload: EmbeddingVectorCleanupJobPayload = {
          references: dedupedReferences.slice(offset, offset + VECTOR_CLEANUP_JOB_MAX_REFERENCES),
        }

        await jobQueue.enqueue({
          type: EMBEDDING_VECTOR_CLEANUP_JOB_TYPE,
          payload,
          priority: VECTOR_CLEANUP_JOB_PRIORITY,
        })
      }
    },

    async processQueuedDocuments(requests, now = Date.now()): Promise<EmbeddingFlushResult> {
      if (activeTargetedFlush) {
        return activeTargetedFlush
      }

      activeTargetedFlush = (async (): Promise<EmbeddingFlushResult> => {
        if (requests.length === 0) {
          return { queued: 0, processed: 0, skipped: 0 }
        }

        const uniqueRequests = [
          ...new Map(requests.map((item) => [item.documentId, item])).values(),
        ]
        const selectedJobs: DocumentEmbeddingJobEntity[] = []

        for (const request of uniqueRequests) {
          const queuedJob = await repos.embeddingIndexQueue.getQueuedDocument(request.documentId)
          if (!queuedJob) continue
          if (
            request.expectedLastQueuedAt !== undefined &&
            queuedJob.lastQueuedAt !== request.expectedLastQueuedAt
          ) {
            continue
          }
          selectedJobs.push(queuedJob)
        }

        const runtimeConfig = configOptions.getRuntimeConfig?.() ?? DEFAULT_RUNTIME_CONFIG

        return processJobs(selectedJobs, uniqueRequests.length, now, runtimeConfig)
      })().finally(() => {
        activeTargetedFlush = null
      })

      return activeTargetedFlush
    },

    async flushDueQueue(
      config: EmbeddingIndexRuntimeConfig,
      now = Date.now()
    ): Promise<EmbeddingFlushResult> {
      if (activeFlush) {
        return activeFlush
      }

      activeFlush = (async (): Promise<EmbeddingFlushResult> => {
        const jobs = await repos.embeddingIndexQueue.listQueuedDocuments()
        if (jobs.length === 0) {
          return { queued: 0, processed: 0, skipped: 0 }
        }

        const dueJobs = pickDueJobs(jobs, config, now)
        if (dueJobs.length === 0) {
          return { queued: jobs.length, processed: 0, skipped: 0 }
        }
        return processJobs(dueJobs, jobs.length, now, config)
      })().finally(() => {
        activeFlush = null
      })

      return activeFlush
    },

    async getQueueStats(): Promise<DocumentEmbeddingQueueStats> {
      return repos.embeddingIndexQueue.getQueueStats()
    },
  }
}
