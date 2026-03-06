import { createHash } from 'node:crypto'
import type { RepositorySet } from '../ports/types.js'
import type { TransactionPort } from '../ports/transaction.port.js'
import type { AiSettingsService } from './aiSettings.service.js'
import type {
  DocumentEmbeddingJobEntity,
  DocumentEmbeddingQueueStats,
} from '../ports/documentEmbeddings.port.js'
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

export function createEmbeddingIndexService(
  repos: RepositorySet,
  transaction: TransactionPort,
  aiSettingsService: AiSettingsService,
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
          text: string
          contentHash: string
          expectedLastQueuedAt: number
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
          const contentHash = hashEmbeddingText(text)
          const existing = await repos.documentEmbeddings.findEmbedding(
            document.id,
            selection.baseURL,
            selection.model
          )

          if (existing?.contentHash === contentHash) {
            candidatesToClear.push({
              documentId: document.id,
              expectedLastQueuedAt: job.lastQueuedAt,
            })
            skipped += 1
            continue
          }

          documentsToEmbed.push({
            documentId: document.id,
            text,
            contentHash,
            expectedLastQueuedAt: job.lastQueuedAt,
          })
        }

        let processed = 0
        const queueIdsToClear = new Set<string>()

        if (documentsToEmbed.length > 0) {
          const embeddings = await provider.embed(documentsToEmbed.map((item) => item.text))

          await transaction.run(async () => {
            for (const [index, item] of documentsToEmbed.entries()) {
              const embedding = embeddings[index]?.embedding
              if (!embedding) {
                throw new Error(`Missing embedding vector for document ${item.documentId}.`)
              }

              const currentJob = await repos.documentEmbeddings.getQueuedDocument(item.documentId)
              if (!currentJob || currentJob.lastQueuedAt !== item.expectedLastQueuedAt) {
                continue
              }

              await repos.documentEmbeddings.upsertEmbedding({
                documentId: item.documentId,
                providerConfigId: selection.providerConfigId,
                providerId: selection.providerId,
                type: selection.type,
                baseURL: selection.baseURL,
                model: selection.model,
                contentHash: item.contentHash,
                embedding,
                createdAt: now,
                updatedAt: now,
              })
              queueIdsToClear.add(item.documentId)
              processed += 1
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
