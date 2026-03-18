import type { DocumentEmbeddingVectorReference } from '../ports/documentEmbeddings.port.js'

export interface EmbeddingVectorCleanupJobPayload {
  references: DocumentEmbeddingVectorReference[]
}
