import type { QueueJobEnvelope } from '../core/ports/jobQueue.port.js'
import type { EmbeddingIndexService } from '../core/services/embeddingIndex.service.js'
import type { JobBatchHandler } from './job-worker-runtime.js'
import { EMBEDDING_REINDEX_JOB_TYPE } from '../core/jobs/job-types.js'

export { EMBEDDING_REINDEX_JOB_TYPE }

/**
 * The payload stored in each `embedding.reindex-document` job envelope.
 *
 * Each envelope corresponds to one document's dedupe slot in the queue.
 * The `lastQueuedAt` field is used as a generation guard: if the envelope was
 * superseded by a later enqueue before the worker processed it, the handler
 * will skip write-back for that document rather than overwriting fresher state.
 */
export interface EmbeddingReindexJobPayload {
  documentId: string
  firstQueuedAt: number
  lastQueuedAt: number
  debounceUntil: number
}

/**
 * Creates the batch handler for `embedding.reindex-document` job envelopes.
 *
 * ## Why this uses `mode: 'batch'`
 *
 * Embedding providers charge per-batch and perform best when given many text
 * inputs in a single request. Leasing envelopes individually and calling the
 * provider once per document would be order-of-magnitude less efficient.
 *
 * With `mode: 'batch'`, `JobWorkerRuntime` groups all leased envelopes of this
 * type together and passes them to this handler in a single call. The handler
 * translates the envelope set into targeted document processing requests so
 * that only the work owned by those specific leases is executed — no global
 * queue flush, no spill to other envelopes.
 *
 * ## Failure semantics
 *
 * If the handler throws, `JobWorkerRuntime` will call `queue.fail()` for every
 * leased envelope in the batch using per-envelope exponential back-off. Each
 * document's dedupe entry stays in the queue and will be retried independently.
 */
export function createEmbeddingReindexBatchHandler(embeddingIndex: EmbeddingIndexService): {
  mode: 'batch'
  handle: JobBatchHandler
} {
  return {
    mode: 'batch',
    handle: async (jobs: QueueJobEnvelope<unknown>[]): Promise<void> => {
      const requests: Array<{ documentId: string; expectedLastQueuedAt?: number }> = []

      for (const job of jobs) {
        const payload = job.payload as Partial<EmbeddingReindexJobPayload>
        const documentId =
          typeof payload.documentId === 'string' && payload.documentId.length > 0
            ? payload.documentId
            : job.dedupeKey // fall back to dedupe key (documentId) as a safety net
        if (!documentId) continue

        const expectedLastQueuedAt =
          typeof payload.lastQueuedAt === 'number' ? payload.lastQueuedAt : undefined

        requests.push(
          expectedLastQueuedAt === undefined ? { documentId } : { documentId, expectedLastQueuedAt }
        )
      }

      if (requests.length === 0) return
      await embeddingIndex.processQueuedDocuments(requests)
    },
  }
}
