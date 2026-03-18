import type { AiModelSourceType, IndexingStrategy } from '@lucentdocs/shared'

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
  selectionFrom: number | null
  selectionTo: number | null
  vectorKey: string
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
  selectionFrom?: number | null
  selectionTo?: number | null
  text: string
  vectorKey?: string
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

export interface SearchProjectDocumentEmbeddingsInput {
  projectId: string
  baseURL: string
  model: string
  queryEmbedding: number[]
  limit: number
  scope:
    | { type: 'project' }
    | { type: 'directory'; directoryPath: string }
    | { type: 'directory_subtree'; directoryPath: string }
}

export interface SearchDocumentEmbeddingsInput {
  documentId: string
  baseURL: string
  model: string
  queryEmbedding: number[]
  limit: number
}

export interface ProjectDocumentEmbeddingSearchMatch {
  documentId: string
  title: string
  createdAt: number
  updatedAt: number
  strategyType: 'whole_document' | 'sliding_window'
  chunkOrdinal: number
  chunkStart: number
  chunkEnd: number
  selectionFrom: number | null
  selectionTo: number | null
  chunkText: string
  distance: number
}

export interface DocumentEmbeddingVectorReference {
  documentId: string
  vectorKey: string
  dimensions: number
  /**
   * Backend-specific stable identifier for the stored vector payload.
   *
   * For the SQLite vec0 backend, this corresponds to the `document_embedding_vector_rows.id`
   * value which is used as the `rowid` in the `document_embedding_vec_*` virtual tables.
   *
   * Other backends may omit this field.
   */
  vectorRowId?: number
}

export interface DocumentEmbeddingsRepositoryPort {
  findEmbeddings(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<DocumentEmbeddingEntity[]>
  searchDocument(
    input: SearchDocumentEmbeddingsInput
  ): Promise<ProjectDocumentEmbeddingSearchMatch[]>
  searchProjectDocuments(
    input: SearchProjectDocumentEmbeddingsInput
  ): Promise<ProjectDocumentEmbeddingSearchMatch[]>
  replaceEmbeddings(input: ReplaceDocumentEmbeddingsInput): Promise<ReplaceDocumentEmbeddingsResult>
  listVectorReferencesByDocumentIds(
    documentIds: string[]
  ): Promise<DocumentEmbeddingVectorReference[]>
  deleteVectorsByReferences(references: DocumentEmbeddingVectorReference[]): Promise<void>
  deleteEmbeddingsByDocumentId(documentId: string): Promise<void>
}
