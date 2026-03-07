import type { AiModelSourceType, IndexingStrategy } from '@lucentdocs/shared'

export interface DocumentEmbeddingJobEntity {
  documentId: string
  firstQueuedAt: number
  lastQueuedAt: number
  debounceUntil: number
}

export interface DocumentEmbeddingEntity {
  id: number
  documentId: string
  providerConfigId: string | null
  providerId: string
  type: AiModelSourceType
  baseURL: string
  model: string
  strategy: IndexingStrategy
  chunkOrdinal: number
  chunkStart: number
  chunkEnd: number
  chunkText: string
  dimensions: number
  documentTimestamp: number
  contentHash: string
  createdAt: number
  updatedAt: number
}

export interface ReplaceDocumentEmbeddingChunkInput {
  ordinal: number
  start: number
  end: number
  text: string
  embedding: number[]
}

export interface ReplaceDocumentEmbeddingsInput {
  documentId: string
  providerConfigId: string | null
  providerId: string
  type: AiModelSourceType
  baseURL: string
  model: string
  strategy: IndexingStrategy
  documentTimestamp: number
  contentHash: string
  chunks: ReplaceDocumentEmbeddingChunkInput[]
  createdAt: number
  updatedAt: number
}

export interface ReplaceDocumentEmbeddingsResult {
  status: 'applied' | 'stale'
  embeddings: DocumentEmbeddingEntity[]
}

export interface DocumentEmbeddingQueueStats {
  totalJobs: number
  oldestQueuedAt: number | null
  nextDebounceUntil: number | null
}

export interface DocumentEmbeddingsRepositoryPort {
  enqueueDocument(documentId: string, queuedAt: number, debounceUntil: number): Promise<void>
  listQueuedDocuments(): Promise<DocumentEmbeddingJobEntity[]>
  getQueuedDocument(documentId: string): Promise<DocumentEmbeddingJobEntity | undefined>
  clearQueuedDocuments(documentIds: string[]): Promise<void>
  getQueueStats(): Promise<DocumentEmbeddingQueueStats>
  findEmbeddings(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<DocumentEmbeddingEntity[]>
  replaceEmbeddings(input: ReplaceDocumentEmbeddingsInput): Promise<ReplaceDocumentEmbeddingsResult>
  deleteEmbeddingsByDocumentId(documentId: string): Promise<void>
}
