import type { DocumentEmbeddingVectorReference } from '../ports/documentEmbeddings.port.js'
import { createDeferredBatchScheduler } from './deferred-batch-scheduler.js'

export interface DocumentDeleteCleanupScheduler {
  schedule(documentIds: string[], references?: DocumentEmbeddingVectorReference[]): void
}

export function createDocumentDeleteCleanupScheduler(dependencies: {
  deleteDocuments: (
    documentIds: string[],
    references: DocumentEmbeddingVectorReference[]
  ) => Promise<void>
}): DocumentDeleteCleanupScheduler {
  const scheduler = createDeferredBatchScheduler<{
    documentIds: string[]
    references: DocumentEmbeddingVectorReference[]
  }>({
    merge: (queued, incoming) => ({
      documentIds: queued
        ? [...queued.documentIds, ...incoming.documentIds]
        : [...incoming.documentIds],
      references: queued
        ? [...queued.references, ...incoming.references]
        : [...incoming.references],
    }),
    isEmpty: (batch) => batch.documentIds.length === 0,
    run: async (batch) => {
      await dependencies.deleteDocuments([...new Set(batch.documentIds)], batch.references)
    },
    onError: (error) => {
      console.warn('[cleanup] Deferred delete cleanup failed:', error)
    },
  })

  return {
    schedule(documentIds: string[], references: DocumentEmbeddingVectorReference[] = []): void {
      if (documentIds.length === 0) return

      // Request-path deletes publish cleanup intent; queue writes are deferred
      // to avoid contention against request-critical primary-store operations.
      // Tradeoff: this in-memory scheduler is best-effort. If the process exits
      // before the microtask drain runs, cleanup jobs may be skipped. A periodic
      // sweeper is expected to reconcile any orphan vectors left behind.
      scheduler.schedule({
        documentIds,
        references,
      })
    },
  }
}
