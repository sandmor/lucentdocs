import { indexingStrategySchema } from '@lucentdocs/shared'
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
import { normalizeBaseURL, normalizeModelSourceType } from '../../core/ai/provider-types.js'
import type { SqliteConnection } from './connection.js'
import { fromJsonField, toJsonField } from './utils.js'

interface EmbeddingRow {
  id: number
  vectorKey: string
  documentId: string
  providerConfigId: string | null
  providerId: string
  type: string
  baseUrl: string
  model: string
  strategyType: string
  strategyProperties: string
  chunkOrdinal: number
  chunkStart: number
  chunkEnd: number
  selectionFrom: number | null
  selectionTo: number | null
  dimensions: number
  documentTimestamp: number
  contentHash: string
  createdAt: number
  updatedAt: number
}

interface SearchRow {
  vectorKey: string
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
}

function splitDocumentPath(title: string): {
  parentDirectory: string
  directoryAncestors: string[]
} {
  const normalized = title.trim().replace(/^\/+|\/+$/g, '')
  if (!normalized.includes('/')) {
    return {
      parentDirectory: '',
      directoryAncestors: [''],
    }
  }

  const parentDirectory = normalized.slice(0, normalized.lastIndexOf('/'))
  const segments = parentDirectory.split('/').filter((segment) => segment.length > 0)
  const directoryAncestors = ['']
  for (let i = 0; i < segments.length; i += 1) {
    directoryAncestors.push(segments.slice(0, i + 1).join('/'))
  }

  return { parentDirectory, directoryAncestors }
}

function toEmbeddingEntity(row: EmbeddingRow): DocumentEmbeddingEntity {
  return {
    id: row.id,
    vectorKey: row.vectorKey,
    documentId: row.documentId,
    providerConfigId: row.providerConfigId,
    providerId: row.providerId,
    type: normalizeModelSourceType(row.type),
    baseURL: row.baseUrl,
    model: row.model,
    strategy: indexingStrategySchema.parse({
      type: row.strategyType,
      properties: fromJsonField(row.strategyProperties) ?? {},
    }),
    chunkOrdinal: row.chunkOrdinal,
    chunkStart: row.chunkStart,
    chunkEnd: row.chunkEnd,
    selectionFrom: row.selectionFrom,
    selectionTo: row.selectionTo,
    dimensions: row.dimensions,
    documentTimestamp: row.documentTimestamp,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class SqliteDocumentEmbeddingMetadataStore implements DocumentEmbeddingMetadataStorePort {
  constructor(private connection: SqliteConnection) {}

  private listEmbeddingRows(documentId: string, baseURL: string, model: string): EmbeddingRow[] {
    return this.connection.all<EmbeddingRow>(
      `SELECT de.rowid AS id,
              de.vectorKey,
              de.documentId,
              de.providerConfigId,
              de.providerId,
              de.type,
              de.baseUrl,
              de.model,
              de.strategyType,
              de.strategyProperties,
              de.chunkOrdinal,
              de.chunkStart,
              de.chunkEnd,
              de.selectionFrom,
              de.selectionTo,
              de.dimensions,
              de.documentTimestamp,
              de.contentHash,
              de.createdAt,
              de.updatedAt
                FROM document_embeddings AS de
        WHERE de.documentId = ? AND de.baseUrl = ? AND de.model = ?
        ORDER BY de.chunkOrdinal ASC`,
      [documentId, baseURL, model]
    )
  }

  async findEmbeddings(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<DocumentEmbeddingEntity[]> {
    const normalizedBaseURL = normalizeBaseURL(baseURL)
    const normalizedModel = model.trim()

    return this.listEmbeddingRows(documentId, normalizedBaseURL, normalizedModel).map(
      toEmbeddingEntity
    )
  }

  async getLatestTimestamp(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<number | null> {
    const normalizedBaseURL = normalizeBaseURL(baseURL)
    const normalizedModel = model.trim()

    const row = this.connection.get<{ documentTimestamp: number | null }>(
      `SELECT MAX(documentTimestamp) AS documentTimestamp
         FROM document_embeddings
        WHERE documentId = ? AND baseUrl = ? AND model = ?`,
      [documentId, normalizedBaseURL, normalizedModel]
    )

    return row?.documentTimestamp ?? null
  }

  async listVectorReferences(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<EmbeddingVectorReference[]> {
    const normalizedBaseURL = normalizeBaseURL(baseURL)
    const normalizedModel = model.trim()

    return this.connection.all<EmbeddingVectorReference>(
      `SELECT vectorKey, dimensions
         FROM document_embeddings
        WHERE documentId = ? AND baseUrl = ? AND model = ?`,
      [documentId, normalizedBaseURL, normalizedModel]
    )
  }

  async replaceEmbeddings(
    input: ReplaceDocumentEmbeddingsInput,
    chunks: ReplaceEmbeddingMetadataChunkInput[]
  ): Promise<DocumentEmbeddingEntity[]> {
    const normalizedBaseURL = normalizeBaseURL(input.baseURL)
    const normalizedModel = input.model.trim()

    this.connection.transaction(() => {
      const insertSql = `INSERT INTO document_embeddings
            (
              vectorKey,
              documentId,
              providerConfigId,
              providerId,
              type,
              baseUrl,
              model,
              strategyType,
              strategyProperties,
              chunkOrdinal,
              chunkStart,
              chunkEnd,
              selectionFrom,
              selectionTo,
              chunkText,
              dimensions,
              documentTimestamp,
              contentHash,
              createdAt,
              updatedAt
            )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

      this.connection.run(
        `DELETE FROM document_embeddings
         WHERE documentId = ? AND baseUrl = ? AND model = ?`,
        [input.documentId, normalizedBaseURL, normalizedModel]
      )

      for (const chunk of chunks) {
        this.connection.run(insertSql, [
          chunk.vectorKey,
          input.documentId,
          input.providerConfigId,
          input.providerId,
          input.type,
          normalizedBaseURL,
          normalizedModel,
          input.strategy.type,
          toJsonField(input.strategy.properties),
          chunk.ordinal,
          chunk.start,
          chunk.end,
          chunk.selectionFrom,
          chunk.selectionTo,
          chunk.text,
          chunk.dimensions,
          input.documentTimestamp,
          input.contentHash,
          input.createdAt,
          input.updatedAt,
        ])
      }
    })

    return this.listEmbeddingRows(input.documentId, normalizedBaseURL, normalizedModel).map(
      toEmbeddingEntity
    )
  }

  async deleteEmbeddingsByDocumentId(documentId: string): Promise<void> {
    this.connection.run('DELETE FROM document_embeddings WHERE documentId = ?', [documentId])
  }

  async listVectorReferencesByDocumentId(documentId: string): Promise<EmbeddingVectorReference[]> {
    return this.connection.all<EmbeddingVectorReference>(
      'SELECT vectorKey, dimensions FROM document_embeddings WHERE documentId = ?',
      [documentId]
    )
  }

  async listVectorReferencesByDocumentIds(
    documentIds: string[]
  ): Promise<Array<{ documentId: string; vectorKey: string; dimensions: number }>> {
    const uniqueDocumentIds = [...new Set(documentIds)].filter((id) => typeof id === 'string' && id)
    if (uniqueDocumentIds.length === 0) return []

    return this.connection.all<{ documentId: string; vectorKey: string; dimensions: number }>(
      `WITH requested AS (
         SELECT value AS documentId
           FROM json_each(?)
       )
       SELECT de.documentId,
              de.vectorKey,
              de.dimensions
         FROM document_embeddings AS de
         JOIN requested ON requested.documentId = de.documentId`,
      [JSON.stringify(uniqueDocumentIds)]
    )
  }

  async deleteEmbeddingsByVectorKeys(vectorKeys: string[]): Promise<number> {
    const uniqueVectorKeys = [...new Set(vectorKeys)].filter(
      (key) => typeof key === 'string' && key
    )
    if (uniqueVectorKeys.length === 0) return 0

    const before = this.connection.get<{ count: number }>(
      `WITH requested AS (
         SELECT value AS vectorKey
           FROM json_each(?)
       )
       SELECT COUNT(*) AS count
         FROM document_embeddings AS de
         JOIN requested ON requested.vectorKey = de.vectorKey`,
      [JSON.stringify(uniqueVectorKeys)]
    )

    this.connection.run(
      `WITH requested AS (
         SELECT value AS vectorKey
           FROM json_each(?)
       )
       DELETE FROM document_embeddings
        WHERE vectorKey IN (SELECT vectorKey FROM requested)`,
      [JSON.stringify(uniqueVectorKeys)]
    )

    return before?.count ?? 0
  }

  async getVectorPayloadContext(documentId: string): Promise<DocumentVectorPayloadContext> {
    const documentRow = this.connection.get<{ id: string; title: string }>(
      'SELECT id, title FROM documents WHERE id = ?',
      [documentId]
    )
    if (!documentRow) {
      throw new Error(`Document ${documentId} was not found while building vector payload context.`)
    }

    const projectRows = this.connection.all<{ projectId: string }>(
      'SELECT projectId FROM project_documents WHERE documentId = ? ORDER BY projectId ASC',
      [documentId]
    )
    const { parentDirectory, directoryAncestors } = splitDocumentPath(documentRow.title)

    return {
      documentId,
      parentDirectory,
      directoryAncestors,
      projectIds: projectRows.map((row) => row.projectId),
    }
  }

  async listSearchMetadataByVectorKeys(
    vectorKeys: string[]
  ): Promise<Map<string, EmbeddingSearchMetadata>> {
    if (vectorKeys.length === 0) return new Map<string, EmbeddingSearchMetadata>()

    const rows = this.connection.all<SearchRow>(
      `WITH requested AS (
         SELECT value AS vectorKey
           FROM json_each(?)
       )
       SELECT de.vectorKey,
              de.documentId,
              d.title,
              d.createdAt,
              d.updatedAt,
              de.strategyType,
              de.chunkOrdinal,
              de.chunkStart,
              de.chunkEnd,
              de.selectionFrom,
              de.selectionTo,
              de.chunkText
         FROM document_embeddings AS de
           JOIN requested ON requested.vectorKey = de.vectorKey
         JOIN documents AS d ON d.id = de.documentId
        ORDER BY de.documentId ASC, de.chunkOrdinal ASC`,
      [JSON.stringify(vectorKeys)]
    )

    return new Map(
      rows.map((row) => [
        row.vectorKey,
        {
          documentId: row.documentId,
          title: row.title,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          strategyType: row.strategyType,
          chunkOrdinal: row.chunkOrdinal,
          chunkStart: row.chunkStart,
          chunkEnd: row.chunkEnd,
          selectionFrom: row.selectionFrom,
          selectionTo: row.selectionTo,
          chunkText: row.chunkText,
        } satisfies EmbeddingSearchMetadata,
      ])
    )
  }
}
