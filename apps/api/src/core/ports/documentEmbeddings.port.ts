import type { AiModelSourceType } from '@lucentdocs/shared'

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
  dimensions: number
  contentHash: string
  createdAt: number
  updatedAt: number
}

export interface UpsertDocumentEmbeddingInput {
  documentId: string
  providerConfigId: string | null
  providerId: string
  type: AiModelSourceType
  baseURL: string
  model: string
  contentHash: string
  embedding: number[]
  createdAt: number
  updatedAt: number
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
  findEmbedding(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<DocumentEmbeddingEntity | undefined>
  upsertEmbedding(input: UpsertDocumentEmbeddingInput): Promise<DocumentEmbeddingEntity>
  deleteEmbeddingsByDocumentId(documentId: string): Promise<void>
}
