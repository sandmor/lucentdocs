import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  DocumentEmbeddingEntity,
  DocumentEmbeddingVectorReference,
  DocumentEmbeddingsRepositoryPort,
  ProjectDocumentEmbeddingSearchMatch,
  ReplaceDocumentEmbeddingsInput,
  ReplaceDocumentEmbeddingsResult,
  SearchDocumentEmbeddingsInput,
  SearchProjectDocumentEmbeddingsInput,
} from '../../core/ports/documentEmbeddings.port.js'
import { normalizeBaseURL } from '../../core/ai/provider-types.js'
import {
  validateEmbeddingVector,
  validateReplacementChunks,
  validateSearchLimit,
} from '../../core/embeddings/documentEmbeddings.shared.js'
import { currentTxId } from './tx-scope.js'
import {
  documentEmbeddingFromDto,
  documentEmbeddingVectorReferenceFromDto,
  embeddingSearchMatchFromDto,
  replaceDocumentEmbeddingsResultFromDto,
  replaceDocumentEmbeddingsToDto,
  searchDocumentEmbeddingsToDto,
  searchProjectDocumentEmbeddingsToDto,
} from './mappers.js'
import type { EmbeddingVectorReferenceDto } from '@lucentdocs/core'

export class DocumentEmbeddingsRepository implements DocumentEmbeddingsRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async findEmbeddings(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<DocumentEmbeddingEntity[]> {
    const rows = await this.engine.documentEmbeddingsFindEmbeddings(
      currentTxId(),
      documentId,
      normalizeBaseURL(baseURL),
      model.trim()
    )
    return rows.map(documentEmbeddingFromDto)
  }

  async searchDocument(
    input: SearchDocumentEmbeddingsInput
  ): Promise<ProjectDocumentEmbeddingSearchMatch[]> {
    validateEmbeddingVector(input.queryEmbedding)
    validateSearchLimit(input.limit)

    const rows = await this.engine.documentEmbeddingsSearch(
      currentTxId(),
      searchDocumentEmbeddingsToDto(input)
    )
    return rows.map(embeddingSearchMatchFromDto)
  }

  async searchProjectDocuments(
    input: SearchProjectDocumentEmbeddingsInput
  ): Promise<ProjectDocumentEmbeddingSearchMatch[]> {
    validateEmbeddingVector(input.queryEmbedding)
    validateSearchLimit(input.limit)

    const rows = await this.engine.documentEmbeddingsSearch(
      currentTxId(),
      searchProjectDocumentEmbeddingsToDto(input)
    )
    return rows.map(embeddingSearchMatchFromDto)
  }

  async replaceEmbeddings(
    input: ReplaceDocumentEmbeddingsInput
  ): Promise<ReplaceDocumentEmbeddingsResult> {
    validateReplacementChunks(input)

    const result = await this.engine.documentEmbeddingsReplaceEmbeddings(
      currentTxId(),
      replaceDocumentEmbeddingsToDto(input)
    )
    return replaceDocumentEmbeddingsResultFromDto(result)
  }

  async listVectorReferencesByDocumentIds(
    documentIds: string[]
  ): Promise<DocumentEmbeddingVectorReference[]> {
    const rows = await this.engine.documentEmbeddingsListVectorReferencesByDocumentIds(
      currentTxId(),
      documentIds
    )
    return rows.map(documentEmbeddingVectorReferenceFromDto)
  }

  async deleteVectorsByReferences(references: DocumentEmbeddingVectorReference[]): Promise<void> {
    if (references.length === 0) return

    const dtos: EmbeddingVectorReferenceDto[] = references.map((reference) => ({
      documentId: reference.documentId,
      vectorKey: reference.vectorKey,
      baseUrl: reference.baseURL,
      model: reference.model,
      dimensions: reference.dimensions,
      vectorRowId: reference.vectorRowId,
    }))

    await this.engine.documentEmbeddingsDeleteVectorsByReferences(currentTxId(), dtos)
  }

  async deleteEmbeddingsByDocumentId(documentId: string): Promise<void> {
    await this.engine.documentEmbeddingsDeleteEmbeddingsByDocumentId(currentTxId(), documentId)
  }
}
