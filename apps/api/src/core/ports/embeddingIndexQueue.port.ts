export interface DocumentEmbeddingJobEntity {
  documentId: string
  firstQueuedAt: number
  lastQueuedAt: number
  debounceUntil: number
}

export interface DocumentEmbeddingQueueStats {
  totalJobs: number
  oldestQueuedAt: number | null
  nextDebounceUntil: number | null
}

export interface EmbeddingIndexQueueRepositoryPort {
  enqueueDocument(documentId: string, queuedAt: number, debounceUntil: number): Promise<void>
  enqueueDocuments(documentIds: string[], queuedAt: number, debounceUntil: number): Promise<void>
  listQueuedDocuments(): Promise<DocumentEmbeddingJobEntity[]>
  getQueuedDocument(documentId: string): Promise<DocumentEmbeddingJobEntity | undefined>
  clearQueuedDocuments(documentIds: string[]): Promise<void>
  getQueueStats(): Promise<DocumentEmbeddingQueueStats>
}
