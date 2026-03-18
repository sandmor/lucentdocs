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
import { indexingStrategySchema } from '@lucentdocs/shared'
import { normalizeModelSourceType, normalizeBaseURL } from '../../core/ai/provider-types.js'
import type { SqliteConnection } from './connection.js'
import { fromJsonField, toJsonField } from './utils.js'
import {
  MAX_EMBEDDING_DIMENSIONS,
  resolveChunkVectorKey,
  validateEmbeddingVector,
  validateReplacementChunks,
  validateSearchLimit,
} from '../../core/embeddings/documentEmbeddings.shared.js'

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
  chunkText: string
  dimensions: number
  documentTimestamp: number
  contentHash: string
  createdAt: number
  updatedAt: number
}

interface SearchMatchRow {
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

type EmbeddingSearchScope =
  | { kind: 'document'; documentId: string }
  | { kind: 'project'; projectId: string; directoryPath?: string; directoryExact?: boolean }

interface EmbeddingSearchQueryOptions {
  input: SearchDocumentEmbeddingsInput | SearchProjectDocumentEmbeddingsInput
  dimensions: number
  normalizedBaseURL: string
  model: string
  scope: EmbeddingSearchScope
}

function escapeSqlLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function vectorTableName(dimensions: number): string {
  if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > MAX_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Invalid embedding dimension ${dimensions}. Must be a positive integer <= ${MAX_EMBEDDING_DIMENSIONS}.`
    )
  }
  return `document_embedding_vec_${dimensions}`
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

export class DocumentEmbeddingsRepository implements DocumentEmbeddingsRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  private hasVectorTable(tableName: string): boolean {
    const row = this.connection.get<{ found: number }>(
      `SELECT 1 AS found
         FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1`,
      [tableName]
    )
    return row?.found === 1
  }

  private lookupVectorRowId(vectorKey: string): number {
    const row = this.connection.get<{ id: number }>(
      'SELECT id FROM document_embedding_vector_rows WHERE vectorKey = ?',
      [vectorKey]
    )
    if (!row) {
      throw new Error('Failed to read stored document embedding vector row.')
    }

    return row.id
  }

  private listEmbeddingVectorRows(
    documentId: string,
    baseURL: string,
    model: string
  ): Array<{ id: number; vectorKey: string; dimensions: number }> {
    return this.connection.all<{ id: number; vectorKey: string; dimensions: number }>(
      `SELECT vr.id, vr.vectorKey, vr.dimensions
         FROM document_embedding_vector_rows AS vr
         JOIN document_embeddings AS de ON de.vectorKey = vr.vectorKey
        WHERE de.documentId = ? AND de.baseUrl = ? AND de.model = ?`,
      [documentId, baseURL, model]
    )
  }

  private listEmbeddingRows(documentId: string, baseURL: string, model: string): EmbeddingRow[] {
    return this.connection.all<EmbeddingRow>(
      `SELECT vr.id,
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
              de.chunkText,
              de.dimensions,
              de.documentTimestamp,
              de.contentHash,
              de.createdAt,
              de.updatedAt
         FROM document_embeddings AS de
         JOIN document_embedding_vector_rows AS vr ON vr.vectorKey = de.vectorKey
        WHERE de.documentId = ? AND de.baseUrl = ? AND de.model = ?
        ORDER BY de.chunkOrdinal ASC`,
      [documentId, baseURL, model]
    )
  }

  /**
   * Executes a vector search against stored embedding rows after the caller
   * provides a scope filter for the candidate set.
   */
  private searchMatches(
    options: EmbeddingSearchQueryOptions
  ): ProjectDocumentEmbeddingSearchMatch[] {
    const limit = validateSearchLimit(options.input.limit)
    const tableName = vectorTableName(options.dimensions)
    if (!this.hasVectorTable(tableName)) {
      return []
    }

    const scopeFragments: string[] = []
    const scopeParams: Array<string> = []

    if (options.scope.kind === 'document') {
      scopeFragments.push('candidate.documentId = ?')
      scopeParams.push(options.scope.documentId)
    } else {
      scopeFragments.push(
        `candidate.documentId IN (
            SELECT pd.documentId
              FROM project_documents AS pd
              JOIN documents AS scoped_doc ON scoped_doc.id = pd.documentId
             WHERE pd.projectId = ?`
      )
      scopeParams.push(options.scope.projectId)

      if (options.scope.directoryPath !== undefined) {
        if (options.scope.directoryPath !== '') {
          const escapedDirectoryPath = escapeSqlLikePattern(options.scope.directoryPath)
          if (options.scope.directoryExact) {
            scopeFragments.push(
              `               AND scoped_doc.title LIKE ? ESCAPE '\\'
                   AND scoped_doc.title NOT LIKE ? ESCAPE '\\'`
            )
            scopeParams.push(`${escapedDirectoryPath}/%`, `${escapedDirectoryPath}/%/%`)
          } else {
            scopeFragments.push(
              `               AND (
                    scoped_doc.title = ?
                    OR scoped_doc.title LIKE ? ESCAPE '\\'
                  )`
            )
            scopeParams.push(options.scope.directoryPath, `${escapedDirectoryPath}/%`)
          }
        } else if (options.scope.directoryExact) {
          scopeFragments.push(`               AND scoped_doc.title NOT LIKE ? ESCAPE '\\'`)
          scopeParams.push(`%/%`)
        }
      }

      scopeFragments.push('          )')
    }

    const scopeSql = scopeFragments.join('\n')

    const params: Array<string | number | Float32Array> = [
      new Float32Array(options.input.queryEmbedding),
      limit,
      options.dimensions,
      ...scopeParams,
      options.normalizedBaseURL,
      options.model,
    ]

    return this.connection.all<SearchMatchRow>(
      `SELECT de.documentId,
              d.title,
              d.createdAt,
              d.updatedAt,
              de.strategyType,
              de.chunkOrdinal,
              de.chunkStart,
              de.chunkEnd,
              de.selectionFrom,
              de.selectionTo,
              de.chunkText,
              v.distance
         FROM ${tableName} AS v
         JOIN document_embedding_vector_rows AS vr ON vr.id = v.rowid
         JOIN document_embeddings AS de ON de.vectorKey = vr.vectorKey
         JOIN documents AS d ON d.id = de.documentId
        WHERE v.embedding MATCH ?
          AND k = ?
          AND v.rowid IN (
            SELECT candidate_vr.id
              FROM document_embedding_vector_rows AS candidate_vr
              JOIN document_embeddings AS candidate ON candidate.vectorKey = candidate_vr.vectorKey
             WHERE candidate_vr.dimensions = ?
               AND ${scopeSql}
               AND candidate.baseUrl = ?
               AND candidate.model = ?
          )
        ORDER BY v.distance ASC, de.documentId ASC, de.chunkOrdinal ASC`,
      params
    )
  }

  async findEmbeddings(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<DocumentEmbeddingEntity[]> {
    const rows = this.listEmbeddingRows(documentId, normalizeBaseURL(baseURL), model.trim())
    return rows.map(toEmbeddingEntity)
  }

  async searchDocument(
    input: SearchDocumentEmbeddingsInput
  ): Promise<ProjectDocumentEmbeddingSearchMatch[]> {
    validateEmbeddingVector(input.queryEmbedding)

    const dimensions = input.queryEmbedding.length
    const normalizedBaseURL = normalizeBaseURL(input.baseURL)
    const model = input.model.trim()

    return this.searchMatches({
      input,
      dimensions,
      normalizedBaseURL,
      model,
      scope: { kind: 'document', documentId: input.documentId },
    })
  }

  async searchProjectDocuments(
    input: SearchProjectDocumentEmbeddingsInput
  ): Promise<ProjectDocumentEmbeddingSearchMatch[]> {
    validateEmbeddingVector(input.queryEmbedding)

    const dimensions = input.queryEmbedding.length
    const normalizedBaseURL = normalizeBaseURL(input.baseURL)
    const model = input.model.trim()

    return this.searchMatches({
      input,
      dimensions,
      normalizedBaseURL,
      model,
      scope:
        input.scope.type === 'project'
          ? { kind: 'project', projectId: input.projectId }
          : {
              kind: 'project',
              projectId: input.projectId,
              directoryPath: input.scope.directoryPath,
              directoryExact: input.scope.type === 'directory',
            },
    })
  }

  async replaceEmbeddings(
    input: ReplaceDocumentEmbeddingsInput
  ): Promise<ReplaceDocumentEmbeddingsResult> {
    validateReplacementChunks(input)

    const normalizedBaseURL = normalizeBaseURL(input.baseURL)
    const model = input.model.trim()

    return this.connection.transaction(() => {
      const latestStoredTimestamp = this.connection.get<{ documentTimestamp: number | null }>(
        `SELECT MAX(documentTimestamp) AS documentTimestamp
           FROM document_embeddings
          WHERE documentId = ? AND baseUrl = ? AND model = ?`,
        [input.documentId, normalizedBaseURL, model]
      )

      if (
        latestStoredTimestamp?.documentTimestamp !== null &&
        latestStoredTimestamp?.documentTimestamp !== undefined &&
        latestStoredTimestamp.documentTimestamp > input.documentTimestamp
      ) {
        return {
          status: 'stale',
          embeddings: this.listEmbeddingRows(input.documentId, normalizedBaseURL, model).map(
            toEmbeddingEntity
          ),
        }
      }

      const existing = this.listEmbeddingVectorRows(input.documentId, normalizedBaseURL, model)
      for (const row of existing) {
        this.connection.run(`DELETE FROM ${vectorTableName(row.dimensions)} WHERE rowid = ?`, [
          row.id,
        ])
      }

      this.connection.run(
        `DELETE FROM document_embeddings
         WHERE documentId = ? AND baseUrl = ? AND model = ?`,
        [input.documentId, normalizedBaseURL, model]
      )

      for (const chunk of input.chunks) {
        const dimensions = chunk.embedding.length
        const targetTable = vectorTableName(dimensions)
        const vectorKey = resolveChunkVectorKey(input, chunk, normalizedBaseURL, model)

        this.connection.run(
          `INSERT INTO document_embeddings
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
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            vectorKey,
            input.documentId,
            input.providerConfigId,
            input.providerId,
            input.type,
            normalizedBaseURL,
            model,
            input.strategy.type,
            toJsonField(input.strategy.properties),
            chunk.ordinal,
            chunk.start,
            chunk.end,
            chunk.selectionFrom ?? null,
            chunk.selectionTo ?? null,
            chunk.text,
            dimensions,
            input.documentTimestamp,
            input.contentHash,
            input.createdAt,
            input.updatedAt,
          ]
        )

        this.connection.run(
          'INSERT INTO document_embedding_vector_rows (vectorKey, dimensions) VALUES (?, ?)',
          [vectorKey, dimensions]
        )

        const vectorRowId = this.lookupVectorRowId(vectorKey)

        this.connection.exec(
          `CREATE VIRTUAL TABLE IF NOT EXISTS ${targetTable} USING vec0(embedding float[${dimensions}] distance_metric=cosine)`
        )
        this.connection.run(`DELETE FROM ${targetTable} WHERE rowid = ?`, [vectorRowId])
        this.connection.run(`INSERT INTO ${targetTable} (rowid, embedding) VALUES (?, ?)`, [
          vectorRowId,
          new Float32Array(chunk.embedding),
        ])
      }

      return {
        status: 'applied',
        embeddings: this.listEmbeddingRows(input.documentId, normalizedBaseURL, model).map(
          toEmbeddingEntity
        ),
      }
    })
  }

  async listVectorReferencesByDocumentIds(
    documentIds: string[]
  ): Promise<DocumentEmbeddingVectorReference[]> {
    const uniqueDocumentIds = [...new Set(documentIds)].filter((id) => typeof id === 'string' && id)
    if (uniqueDocumentIds.length === 0) return []

    const rows = this.connection.all<{
      documentId: string
      vectorKey: string
      dimensions: number
      vectorRowId: number | null
    }>(
      `WITH requested AS (
         SELECT value AS documentId
           FROM json_each(?)
       )
       SELECT de.documentId,
              de.vectorKey,
              de.dimensions,
              vr.id AS vectorRowId
         FROM document_embeddings AS de
         JOIN requested ON requested.documentId = de.documentId
         LEFT JOIN document_embedding_vector_rows AS vr ON vr.vectorKey = de.vectorKey`,
      [JSON.stringify(uniqueDocumentIds)]
    )

    return rows.map((row) => {
      const reference: DocumentEmbeddingVectorReference = {
        documentId: row.documentId,
        vectorKey: row.vectorKey,
        dimensions: row.dimensions,
      }
      if (typeof row.vectorRowId === 'number') {
        reference.vectorRowId = row.vectorRowId
      }
      return reference
    })
  }

  async deleteVectorsByReferences(references: DocumentEmbeddingVectorReference[]): Promise<void> {
    if (references.length === 0) return

    const uniqueReferences = [
      ...new Map(
        references
          .filter(
            (reference) =>
              reference.vectorKey &&
              Number.isInteger(reference.dimensions) &&
              reference.dimensions > 0 &&
              (reference.vectorRowId === undefined ||
                (Number.isInteger(reference.vectorRowId) && reference.vectorRowId > 0))
          )
          .map((reference) => [
            `${reference.vectorKey}:${reference.dimensions}:${reference.vectorRowId ?? ''}`,
            reference,
          ])
      ).values(),
    ]
    if (uniqueReferences.length === 0) return

    const allVectorKeys = [...new Set(uniqueReferences.map((reference) => reference.vectorKey))]
    const groupedByDimensions = new Map<
      number,
      {
        vectorKeys: Set<string>
        rowIds: Set<number>
      }
    >()
    for (const reference of uniqueReferences) {
      const group = groupedByDimensions.get(reference.dimensions) ?? {
        vectorKeys: new Set<string>(),
        rowIds: new Set<number>(),
      }
      group.vectorKeys.add(reference.vectorKey)
      if (reference.vectorRowId !== undefined) {
        group.rowIds.add(reference.vectorRowId)
      }
      groupedByDimensions.set(reference.dimensions, group)
    }

    this.connection.transaction(() => {
      // Resolve vec0 rowids before deleting metadata; metadata deletion may cascade vector-row entries.
      const resolvedRowIdsByDimensions = new Map<number, number[]>()
      for (const [dimensions, group] of groupedByDimensions) {
        if (group.rowIds.size > 0) {
          resolvedRowIdsByDimensions.set(dimensions, [...group.rowIds])
          continue
        }

        if (group.vectorKeys.size === 0) continue
        const rows = this.connection.all<{ id: number }>(
          `WITH requested AS (
             SELECT value AS vectorKey
               FROM json_each(?)
           )
           SELECT vr.id
             FROM document_embedding_vector_rows AS vr
             JOIN requested ON requested.vectorKey = vr.vectorKey
            WHERE vr.dimensions = ?`,
          [JSON.stringify([...group.vectorKeys]), dimensions]
        )
        if (rows.length > 0) {
          resolvedRowIdsByDimensions.set(
            dimensions,
            rows.map((row) => row.id)
          )
        }
      }

      for (const [dimensions, rowIds] of resolvedRowIdsByDimensions) {
        if (rowIds.length === 0) continue
        const targetTable = vectorTableName(dimensions)
        const rowIdJson = JSON.stringify(rowIds)

        if (this.hasVectorTable(targetTable)) {
          this.connection.run(
            `WITH requested_ids AS (
               SELECT CAST(value AS INTEGER) AS rowId
                 FROM json_each(?)
             )
             DELETE FROM ${targetTable}
              WHERE rowid IN (SELECT rowId FROM requested_ids)`,
            [rowIdJson]
          )
        }

        // Best-effort cleanup of mapping rows (may already be gone via cascades).
        this.connection.run(
          `WITH requested_ids AS (
             SELECT CAST(value AS INTEGER) AS rowId
               FROM json_each(?)
           )
           DELETE FROM document_embedding_vector_rows
            WHERE id IN (SELECT rowId FROM requested_ids)`,
          [rowIdJson]
        )
      }

      // Best-effort metadata cleanup (may already be gone via cascades).
      this.connection.run(
        `WITH requested AS (
           SELECT value AS vectorKey
             FROM json_each(?)
         )
         DELETE FROM document_embeddings
          WHERE vectorKey IN (SELECT vectorKey FROM requested)`,
        [JSON.stringify(allVectorKeys)]
      )
    })

    for (const dimensions of groupedByDimensions.keys()) {
      const table = vectorTableName(dimensions)
      if (!this.hasVectorTable(table)) continue

      const countRow = this.connection.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${table}`,
        []
      )
      if ((countRow?.count ?? 0) === 0) {
        this.connection.exec(`DROP TABLE IF EXISTS ${table}`)
      }
    }
  }

  async deleteEmbeddingsByDocumentId(documentId: string): Promise<void> {
    const references = await this.listVectorReferencesByDocumentIds([documentId])
    await this.deleteVectorsByReferences(references)
  }
}
