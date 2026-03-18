import type {
  DocumentEmbeddingEntity,
  DocumentEmbeddingVectorReference,
  ProjectDocumentEmbeddingSearchMatch,
  ReplaceDocumentEmbeddingsInput,
} from './documentEmbeddings.port.js'

export interface EmbeddingVectorReference {
  vectorKey: string
  dimensions: number
}

export interface DocumentVectorPayloadContext {
  documentId: string
  parentDirectory: string
  directoryAncestors: string[]
  projectIds: string[]
}

export type EmbeddingSearchMetadata = Omit<ProjectDocumentEmbeddingSearchMatch, 'distance'>

export interface ReplaceEmbeddingMetadataChunkInput {
  vectorKey: string
  ordinal: number
  start: number
  end: number
  selectionFrom: number | null
  selectionTo: number | null
  text: string
  dimensions: number
}

export interface DocumentEmbeddingMetadataStorePort {
  findEmbeddings(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<DocumentEmbeddingEntity[]>
  getLatestTimestamp(documentId: string, baseURL: string, model: string): Promise<number | null>
  listVectorReferences(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<EmbeddingVectorReference[]>
  replaceEmbeddings(
    input: ReplaceDocumentEmbeddingsInput,
    chunks: ReplaceEmbeddingMetadataChunkInput[]
  ): Promise<DocumentEmbeddingEntity[]>
  deleteEmbeddingsByDocumentId(documentId: string): Promise<void>
  listVectorReferencesByDocumentId(documentId: string): Promise<EmbeddingVectorReference[]>
  listVectorReferencesByDocumentIds(
    documentIds: string[]
  ): Promise<DocumentEmbeddingVectorReference[]>
  deleteEmbeddingsByVectorKeys(vectorKeys: string[]): Promise<number>
  getVectorPayloadContext(documentId: string): Promise<DocumentVectorPayloadContext>
  listSearchMetadataByVectorKeys(
    vectorKeys: string[]
  ): Promise<Map<string, EmbeddingSearchMetadata>>
}
