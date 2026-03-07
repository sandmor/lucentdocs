import { createHash } from 'node:crypto'
import type { IndexingStrategy } from '@lucentdocs/shared'
import type { RepositorySet } from '../ports/types.js'
import type { TransactionPort } from '../ports/transaction.port.js'
import type { AiSettingsService } from './aiSettings.service.js'
import type { IndexingSettingsService } from './indexingSettings.service.js'
import type {
  DocumentEmbeddingJobEntity,
  DocumentEmbeddingQueueStats,
  DocumentEmbeddingEntity,
} from '../ports/documentEmbeddings.port.js'
import { buildEmbeddingChunks } from '../../embeddings/chunking.js'
import { buildDocumentEmbeddingText } from '../../embeddings/document-content.js'
import { getEmbeddingProvider } from '../../embeddings/provider.js'

export interface EmbeddingIndexRuntimeConfig {
  debounceMs: number
  batchMaxWaitMs: number
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
  deleteDocument(documentId: string): Promise<void>
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
  contentHash: string,
  chunks: ReturnType<typeof buildEmbeddingChunks>
): boolean {
  if (chunks.length === 0) {
    return existing.length === 0
  }

  if (existing.length !== chunks.length) {
    return false
  }

  return existing.every((entry, index) => {
    const chunk = chunks[index]
    return (
      entry.contentHash === contentHash &&
      entry.chunkOrdinal === chunk?.ordinal &&
      entry.chunkStart === chunk?.start &&
      entry.chunkEnd === chunk?.end &&
      entry.chunkText === chunk?.text
    )
  })
}

export function createEmbeddingIndexService(
  repos: RepositorySet,
  transaction: TransactionPort,
  aiSettingsService: AiSettingsService,
  indexingSettingsService: IndexingSettingsService,
  configOptions: {
    getRuntimeConfig?: () => EmbeddingIndexRuntimeConfig
  } = {}
): EmbeddingIndexService {
  let activeFlush: Promise<EmbeddingFlushResult> | null = null

  return {
    async enqueueDocument(documentId, options = {}): Promise<void> {
      const document = await repos.documents.findById(documentId)
      if (!document) return

      const queuedAt = options.queuedAt ?? Date.now()
      const debounceMs = options.debounceMs ?? configOptions.getRuntimeConfig?.().debounceMs ?? 0
      await repos.documentEmbeddings.enqueueDocument(documentId, queuedAt, queuedAt + debounceMs)
    },

    async deleteDocument(documentId: string): Promise<void> {
      await repos.documentEmbeddings.deleteEmbeddingsByDocumentId(documentId)
    },

    async flushDueQueue(
      config: EmbeddingIndexRuntimeConfig,
      now = Date.now()
    ): Promise<EmbeddingFlushResult> {
      if (activeFlush) {
        return activeFlush
      }

      activeFlush = (async (): Promise<EmbeddingFlushResult> => {
        const jobs = await repos.documentEmbeddings.listQueuedDocuments()
        if (jobs.length === 0) {
          return { queued: 0, processed: 0, skipped: 0 }
        }

        const dueJobs = pickDueJobs(jobs, config, now)
        if (dueJobs.length === 0) {
          return { queued: jobs.length, processed: 0, skipped: 0 }
        }

        const selection = await aiSettingsService.resolveRuntimeSelection('embedding')
        const provider = await getEmbeddingProvider()
        const documents = await repos.documents.findByIds(dueJobs.map((job) => job.documentId))
        const documentsById = new Map(documents.map((document) => [document.id, document]))

        const documentsToEmbed: Array<{
          documentId: string
          contentHash: string
          documentTimestamp: number
          expectedLastQueuedAt: number
          chunks: ReturnType<typeof buildEmbeddingChunks>
          strategy: IndexingStrategy
        }> = []
        const candidatesToClear: Array<{ documentId: string; expectedLastQueuedAt: number }> = []
        let skipped = 0

        for (const job of dueJobs) {
          const document = documentsById.get(job.documentId)
          if (!document) {
            candidatesToClear.push({
              documentId: job.documentId,
              expectedLastQueuedAt: job.lastQueuedAt,
            })
            continue
          }

          const text = await buildDocumentEmbeddingText(repos, document)
          const documentTimestamp = now
          const resolvedStrategy = await indexingSettingsService.resolveForDocument(document.id)
          if (!resolvedStrategy) {
            candidatesToClear.push({
              documentId: document.id,
              expectedLastQueuedAt: job.lastQueuedAt,
            })
            continue
          }

          const chunks = buildEmbeddingChunks(text, resolvedStrategy.strategy)

          const contentHash = hashEmbeddingText(
            JSON.stringify({
              strategy: resolvedStrategy.strategy,
              text,
            })
          )
          const existing = await repos.documentEmbeddings.findEmbeddings(
            document.id,
            selection.baseURL,
            selection.model
          )

          if (isStoredEmbeddingSetCurrent(existing, contentHash, chunks)) {
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
          const chunkTexts = documentsToEmbed.flatMap((item) =>
            item.chunks.map((chunk) => chunk.text)
          )
          const embeddings = chunkTexts.length > 0 ? await provider.embed(chunkTexts) : []

          await transaction.run(async () => {
            let embeddingOffset = 0

            for (const item of documentsToEmbed) {
              const currentJob = await repos.documentEmbeddings.getQueuedDocument(item.documentId)
              if (!currentJob || currentJob.lastQueuedAt !== item.expectedLastQueuedAt) {
                embeddingOffset += item.chunks.length
                continue
              }

              const nextChunks = item.chunks.map((chunk, chunkIndex) => {
                const embedding = embeddings[embeddingOffset + chunkIndex]?.embedding
                if (!embedding) {
                  throw new Error(
                    `Missing embedding vector for document ${item.documentId} chunk ${chunk.ordinal}.`
                  )
                }

                return {
                  ordinal: chunk.ordinal,
                  start: chunk.start,
                  end: chunk.end,
                  text: chunk.text,
                  embedding,
                }
              })

              embeddingOffset += item.chunks.length

              const replacement = await repos.documentEmbeddings.replaceEmbeddings({
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

              if (replacement.status === 'stale') {
                queueIdsToClear.add(item.documentId)
                skipped += 1
                continue
              }

              queueIdsToClear.add(item.documentId)
              if (item.chunks.length > 0) {
                processed += 1
              }
            }

            for (const candidate of candidatesToClear) {
              const currentJob = await repos.documentEmbeddings.getQueuedDocument(
                candidate.documentId
              )
              if (!currentJob || currentJob.lastQueuedAt !== candidate.expectedLastQueuedAt) {
                continue
              }
              queueIdsToClear.add(candidate.documentId)
            }

            if (queueIdsToClear.size > 0) {
              await repos.documentEmbeddings.clearQueuedDocuments([...queueIdsToClear])
            }
          })
        } else if (candidatesToClear.length > 0) {
          await transaction.run(async () => {
            for (const candidate of candidatesToClear) {
              const currentJob = await repos.documentEmbeddings.getQueuedDocument(
                candidate.documentId
              )
              if (!currentJob || currentJob.lastQueuedAt !== candidate.expectedLastQueuedAt) {
                continue
              }
              queueIdsToClear.add(candidate.documentId)
            }

            if (queueIdsToClear.size > 0) {
              await repos.documentEmbeddings.clearQueuedDocuments([...queueIdsToClear])
            }
          })
        }

        return {
          queued: jobs.length,
          processed,
          skipped,
        }
      })().finally(() => {
        activeFlush = null
      })

      return activeFlush
    },

    async getQueueStats(): Promise<DocumentEmbeddingQueueStats> {
      return repos.documentEmbeddings.getQueueStats()
    },
  }
}
