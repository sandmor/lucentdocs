import type {
  DocumentEmbeddingJobEntity,
  DocumentEmbeddingQueueStats,
  EmbeddingIndexQueueRepositoryPort,
} from '../../core/ports/embeddingIndexQueue.port.js'
import type { JobQueuePort } from '../../core/ports/jobQueue.port.js'
import { EMBEDDING_REINDEX_JOB_TYPE } from '../../core/jobs/job-types.js'

interface EmbeddingQueuePayload {
  documentId: string
  firstQueuedAt: number
  lastQueuedAt: number
  debounceUntil: number
}

export class EmbeddingIndexQueueRepository implements EmbeddingIndexQueueRepositoryPort {
  constructor(private queue: JobQueuePort) {}

  async enqueueDocument(
    documentId: string,
    queuedAt: number,
    debounceUntil: number
  ): Promise<void> {
    const existing = await this.queue.getByTypeAndDedupeKey<EmbeddingQueuePayload>(
      EMBEDDING_REINDEX_JOB_TYPE,
      documentId
    )

    const nextPayload: EmbeddingQueuePayload = existing
      ? {
          documentId,
          firstQueuedAt: existing.payload.firstQueuedAt,
          lastQueuedAt:
            queuedAt > existing.payload.lastQueuedAt ? queuedAt : existing.payload.lastQueuedAt + 1,
          debounceUntil:
            queuedAt > existing.payload.lastQueuedAt
              ? debounceUntil
              : existing.payload.lastQueuedAt + 1 + (debounceUntil - queuedAt),
        }
      : {
          documentId,
          firstQueuedAt: queuedAt,
          lastQueuedAt: queuedAt,
          debounceUntil,
        }

    await this.queue.upsertUnique({
      type: EMBEDDING_REINDEX_JOB_TYPE,
      dedupeKey: documentId,
      payload: nextPayload,
      runAt: nextPayload.debounceUntil,
    })
  }

  async enqueueDocuments(
    documentIds: string[],
    queuedAt: number,
    debounceUntil: number
  ): Promise<void> {
    if (documentIds.length === 0) return

    const existingJobs = await this.queue.getByTypeAndDedupeKeys<EmbeddingQueuePayload>(
      EMBEDDING_REINDEX_JOB_TYPE,
      documentIds
    )
    const existingById = new Map(existingJobs.map((job) => [job.payload.documentId, job.payload]))

    for (const documentId of documentIds) {
      const existing = existingById.get(documentId)

      const nextPayload: EmbeddingQueuePayload = existing
        ? {
            documentId,
            firstQueuedAt: existing.firstQueuedAt,
            lastQueuedAt: queuedAt > existing.lastQueuedAt ? queuedAt : existing.lastQueuedAt + 1,
            debounceUntil:
              queuedAt > existing.lastQueuedAt
                ? debounceUntil
                : existing.lastQueuedAt + 1 + (debounceUntil - queuedAt),
          }
        : {
            documentId,
            firstQueuedAt: queuedAt,
            lastQueuedAt: queuedAt,
            debounceUntil,
          }

      await this.queue.upsertUnique({
        type: EMBEDDING_REINDEX_JOB_TYPE,
        dedupeKey: documentId,
        payload: nextPayload,
        runAt: nextPayload.debounceUntil,
      })
    }
  }

  async listQueuedDocuments(): Promise<DocumentEmbeddingJobEntity[]> {
    const jobs = await this.queue.listQueuedByType<EmbeddingQueuePayload>(
      EMBEDDING_REINDEX_JOB_TYPE
    )
    return jobs
      .map((job) => job.payload)
      .sort((left, right) =>
        left.firstQueuedAt === right.firstQueuedAt
          ? left.debounceUntil - right.debounceUntil
          : left.firstQueuedAt - right.firstQueuedAt
      )
  }

  async getQueuedDocument(documentId: string): Promise<DocumentEmbeddingJobEntity | undefined> {
    const job = await this.queue.getByTypeAndDedupeKey<EmbeddingQueuePayload>(
      EMBEDDING_REINDEX_JOB_TYPE,
      documentId
    )
    return job?.payload
  }

  async clearQueuedDocuments(documentIds: string[]): Promise<void> {
    await this.queue.deleteQueuedByTypeAndDedupeKeys(EMBEDDING_REINDEX_JOB_TYPE, documentIds)
  }

  async getQueueStats(): Promise<DocumentEmbeddingQueueStats> {
    const stats = await this.queue.getTypeStats(EMBEDDING_REINDEX_JOB_TYPE)

    return {
      totalJobs: stats.totalQueued,
      oldestQueuedAt: stats.oldestQueuedAt,
      nextDebounceUntil: stats.nextAvailableAt,
    }
  }
}
