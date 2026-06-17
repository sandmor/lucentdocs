import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  DocumentVectorPayloadContext,
  DocumentEmbeddingMetadataStorePort,
  EmbeddingSearchMetadata,
  EmbeddingVectorReference,
  ReplaceEmbeddingMetadataChunkInput,
} from '../../core/ports/documentEmbeddingMetadata.port.js'
import type {
  DocumentEmbeddingEntity,
  ReplaceDocumentEmbeddingsInput,
} from '../../core/ports/documentEmbeddings.port.js'
import { normalizeBaseURL } from '../../core/ai/provider-types.js'
import { currentTxId } from './tx-scope.js'
import {
  documentEmbeddingFromDto,
  embeddingVectorReferenceFromDto,
  replaceDocumentEmbeddingsToDto,
  replaceEmbeddingMetadataChunkToDto,
  searchMetadataMapFromDto,
  vectorPayloadContextFromDto,
} from './mappers.js'

export class RustDocumentEmbeddingMetadataStore implements DocumentEmbeddingMetadataStorePort {
  constructor(private engine: NativeStorageEngine) {}

  async findEmbeddings(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<DocumentEmbeddingEntity[]> {
    const rows = await this.engine.documentEmbeddingMetadataFindEmbeddings(
      currentTxId(),
      documentId,
      normalizeBaseURL(baseURL),
      model.trim()
    )
    return rows.map(documentEmbeddingFromDto)
  }

  async getLatestTimestamp(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<number | null> {
    return this.engine.documentEmbeddingMetadataGetLatestTimestamp(
      currentTxId(),
      documentId,
      normalizeBaseURL(baseURL),
      model.trim()
    )
  }

  async listVectorReferences(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<EmbeddingVectorReference[]> {
    const rows = await this.engine.documentEmbeddingMetadataListVectorReferences(
      currentTxId(),
      documentId,
      normalizeBaseURL(baseURL),
      model.trim()
    )
    return rows.map(embeddingVectorReferenceFromDto)
  }

  async replaceEmbeddings(
    input: ReplaceDocumentEmbeddingsInput,
    chunks: ReplaceEmbeddingMetadataChunkInput[]
  ): Promise<DocumentEmbeddingEntity[]> {
    const rows = await this.engine.documentEmbeddingMetadataReplaceEmbeddings(
      currentTxId(),
      replaceDocumentEmbeddingsToDto(input),
      chunks.map(replaceEmbeddingMetadataChunkToDto)
    )
    return rows.map(documentEmbeddingFromDto)
  }

  async deleteEmbeddingsByDocumentId(documentId: string): Promise<void> {
    await this.engine.documentEmbeddingMetadataDeleteEmbeddingsByDocumentId(
      currentTxId(),
      documentId
    )
  }

  async listVectorReferencesByDocumentId(documentId: string): Promise<EmbeddingVectorReference[]> {
    const rows = await this.engine.documentEmbeddingMetadataListVectorReferencesByDocumentId(
      currentTxId(),
      documentId
    )
    return rows.map(embeddingVectorReferenceFromDto)
  }

  async listVectorReferencesByDocumentIds(
    documentIds: string[]
  ): Promise<
    Array<{
      documentId: string
      vectorKey: string
      baseURL: string
      model: string
      dimensions: number
    }>
  > {
    const rows = await this.engine.documentEmbeddingMetadataListVectorReferencesByDocumentIds(
      currentTxId(),
      documentIds
    )
    return rows.map((row) => ({
      documentId: row.documentId,
      vectorKey: row.vectorKey,
      baseURL: row.baseUrl,
      model: row.model,
      dimensions: row.dimensions,
    }))
  }

  async deleteEmbeddingsByVectorKeys(vectorKeys: string[]): Promise<number> {
    return this.engine.documentEmbeddingMetadataDeleteEmbeddingsByVectorKeys(
      currentTxId(),
      vectorKeys
    )
  }

  async getVectorPayloadContext(documentId: string): Promise<DocumentVectorPayloadContext> {
    const context = await this.engine.documentEmbeddingMetadataGetVectorPayloadContext(
      currentTxId(),
      documentId
    )
    return vectorPayloadContextFromDto(context)
  }

  async listSearchMetadataByVectorKeys(
    vectorKeys: string[]
  ): Promise<Map<string, EmbeddingSearchMetadata>> {
    const record = await this.engine.documentEmbeddingMetadataListSearchMetadataByVectorKeys(
      currentTxId(),
      vectorKeys
    )
    return searchMetadataMapFromDto(record)
  }
}
