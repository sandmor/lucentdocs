import type { QueueJobEnvelope } from '../core/ports/jobQueue.port.js'
import type {
  DocumentEmbeddingVectorReference,
  DocumentEmbeddingsRepositoryPort,
} from '../core/ports/documentEmbeddings.port.js'
import type { JobBatchHandler } from './job-worker-runtime.js'
import { EMBEDDING_VECTOR_CLEANUP_JOB_TYPE } from '../core/jobs/job-types.js'
import type { EmbeddingVectorCleanupJobPayload } from '../core/jobs/embedding-vector-cleanup-job.js'

export { EMBEDDING_VECTOR_CLEANUP_JOB_TYPE }

export function createEmbeddingVectorCleanupBatchHandler(
  documentEmbeddings: DocumentEmbeddingsRepositoryPort
): {
  mode: 'batch'
  handle: JobBatchHandler
} {
  return {
    mode: 'batch',
    handle: async (jobs: QueueJobEnvelope<unknown>[]): Promise<void> => {
      const references: DocumentEmbeddingVectorReference[] = []

      for (const job of jobs) {
        const payload = job.payload as Partial<EmbeddingVectorCleanupJobPayload>
        if (!payload.references || !Array.isArray(payload.references)) continue

        for (const reference of payload.references) {
          if (
            reference &&
            typeof reference.documentId === 'string' &&
            reference.documentId.length > 0 &&
            typeof reference.vectorKey === 'string' &&
            reference.vectorKey.length > 0 &&
            Number.isInteger(reference.dimensions) &&
            reference.dimensions > 0 &&
            (reference.vectorRowId === undefined ||
              (Number.isInteger(reference.vectorRowId) && reference.vectorRowId > 0))
          ) {
            references.push(reference)
          }
        }
      }

      if (references.length === 0) return
      await documentEmbeddings.deleteVectorsByReferences(references)
    },
  }
}
