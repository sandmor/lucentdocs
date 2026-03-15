import type {
  DocumentEmbeddingEntity,
  DocumentEmbeddingJobEntity,
  DocumentEmbeddingQueueStats,
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
import type { JobQueuePort } from '../../core/ports/jobQueue.port.js'
import { EMBEDDING_REINDEX_JOB_TYPE } from '../../core/jobs/job-types.js'

const MAX_EMBEDDING_DIMENSIONS = 8192

interface EmbeddingQueuePayload {
  documentId: string
  firstQueuedAt: number
  lastQueuedAt: number
  debounceUntil: number
}

interface EmbeddingRow {
  id: number
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
  | { kind: 'project'; projectId: string }

interface EmbeddingSearchQueryOptions {
  input: SearchDocumentEmbeddingsInput | SearchProjectDocumentEmbeddingsInput
  dimensions: number
  normalizedBaseURL: string
  model: string
  scope: EmbeddingSearchScope
}

function vectorTableName(dimensions: number): string {
  if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > MAX_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Invalid embedding dimension ${dimensions}. Must be a positive integer ≤ ${MAX_EMBEDDING_DIMENSIONS}.`
    )
  }
  return `document_embedding_vec_${dimensions}`
}

function validateEmbeddingVector(embedding: number[]): void {
  if (embedding.length === 0) {
    throw new Error('Embedding vector cannot be empty.')
  }

  if (embedding.length > MAX_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding vector exceeds the maximum supported dimension count (${MAX_EMBEDDING_DIMENSIONS}).`
    )
  }

  for (const [index, value] of embedding.entries()) {
    if (!Number.isFinite(value)) {
      throw new Error(`Embedding vector value ${index} is invalid.`)
    }
  }
}

function validateSearchLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Search limit must be a positive integer.')
  }

  return Math.min(limit, 200)
}

function validateReplacementChunks(input: ReplaceDocumentEmbeddingsInput): void {
  const ordinals = new Set<number>()
  const expectedDimensions = input.chunks[0]?.embedding.length ?? null

  for (const [index, chunk] of input.chunks.entries()) {
    if (!Number.isInteger(chunk.ordinal) || chunk.ordinal < 0) {
      throw new Error(`Embedding chunk ${index} has an invalid ordinal.`)
    }

    if (ordinals.has(chunk.ordinal)) {
      throw new Error(`Embedding chunk ordinal ${chunk.ordinal} is duplicated.`)
    }
    ordinals.add(chunk.ordinal)

    if (!Number.isInteger(chunk.start) || chunk.start < 0) {
      throw new Error(`Embedding chunk ${chunk.ordinal} has an invalid start offset.`)
    }

    if (!Number.isInteger(chunk.end) || chunk.end < chunk.start) {
      throw new Error(`Embedding chunk ${chunk.ordinal} has an invalid end offset.`)
    }

    const hasSelectionFrom = chunk.selectionFrom !== undefined && chunk.selectionFrom !== null
    const hasSelectionTo = chunk.selectionTo !== undefined && chunk.selectionTo !== null
    if (hasSelectionFrom !== hasSelectionTo) {
      throw new Error(`Embedding chunk ${chunk.ordinal} has an incomplete editor selection range.`)
    }
    if (hasSelectionFrom) {
      const selectionFrom = chunk.selectionFrom as number
      const selectionTo = chunk.selectionTo as number

      if (!Number.isInteger(selectionFrom) || selectionFrom < 0) {
        throw new Error(`Embedding chunk ${chunk.ordinal} has an invalid selection start.`)
      }
      if (!Number.isInteger(selectionTo) || selectionTo < selectionFrom) {
        throw new Error(`Embedding chunk ${chunk.ordinal} has an invalid selection end.`)
      }
    }

    validateEmbeddingVector(chunk.embedding)

    if (expectedDimensions !== null && chunk.embedding.length !== expectedDimensions) {
      throw new Error('Embedding provider returned inconsistent dimensions for one document.')
    }
  }

  const sortedOrdinals = [...ordinals].sort((left, right) => left - right)
  for (const [index, ordinal] of sortedOrdinals.entries()) {
    if (ordinal !== index) {
      throw new Error('Embedding chunk ordinals must be contiguous and zero-based.')
    }
  }
}

function toEmbeddingEntity(row: EmbeddingRow): DocumentEmbeddingEntity {
  return {
    id: row.id,
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
    chunkText: row.chunkText,
    dimensions: row.dimensions,
    documentTimestamp: row.documentTimestamp,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class DocumentEmbeddingsRepository implements DocumentEmbeddingsRepositoryPort {
  constructor(
    private connection: SqliteConnection,
    private queue: JobQueuePort
  ) {}

  /**
   * Executes a vector search against stored document embedding rows after the
   * caller provides the scope filter for the candidate set.
   */
  private searchMatches(
    options: EmbeddingSearchQueryOptions
  ): ProjectDocumentEmbeddingSearchMatch[] {
    const limit = validateSearchLimit(options.input.limit)
    const tableName = vectorTableName(options.dimensions)
    if (!this.hasVectorTable(tableName)) {
      return []
    }

    const scopeSql =
      options.scope.kind === 'document'
        ? 'candidate.documentId = ?'
        : 'candidate.documentId IN (SELECT pd.documentId FROM project_documents AS pd WHERE pd.projectId = ?)'
    const scopeParam =
      options.scope.kind === 'document' ? options.scope.documentId : options.scope.projectId

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
         JOIN document_embeddings AS de ON de.id = v.rowid
         JOIN documents AS d ON d.id = de.documentId
        WHERE v.embedding MATCH ?
          AND k = ?
          AND v.rowid IN (
            SELECT candidate.id
              FROM document_embeddings AS candidate
             WHERE ${scopeSql}
               AND candidate.baseUrl = ?
               AND candidate.model = ?
               AND candidate.dimensions = ?
          )
        ORDER BY v.distance ASC, de.documentId ASC, de.chunkOrdinal ASC`,
      [
        new Float32Array(options.input.queryEmbedding),
        limit,
        scopeParam,
        options.normalizedBaseURL,
        options.model,
        options.dimensions,
      ]
    )
  }

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

  async enqueueDocument(
    documentId: string,
    queuedAt: number,
    debounceUntil: number
  ): Promise<void> {
    const existing = await this.queue.getByTypeAndDedupeKey<EmbeddingQueuePayload>(
      EMBEDDING_REINDEX_JOB_TYPE,
      documentId
    )

    const nextPayload: EmbeddingQueuePayload = existing
      ? {
          documentId,
          firstQueuedAt: existing.payload.firstQueuedAt,
          lastQueuedAt:
            queuedAt > existing.payload.lastQueuedAt ? queuedAt : existing.payload.lastQueuedAt + 1,
          debounceUntil:
            queuedAt > existing.payload.lastQueuedAt
              ? debounceUntil
              : existing.payload.lastQueuedAt + 1 + (debounceUntil - queuedAt),
        }
      : {
          documentId,
          firstQueuedAt: queuedAt,
          lastQueuedAt: queuedAt,
          debounceUntil,
        }

    await this.queue.upsertUnique({
      type: EMBEDDING_REINDEX_JOB_TYPE,
      dedupeKey: documentId,
      payload: nextPayload,
      runAt: nextPayload.debounceUntil,
    })
  }

  async enqueueDocuments(
    documentIds: string[],
    queuedAt: number,
    debounceUntil: number
  ): Promise<void> {
    if (documentIds.length === 0) return

    const existingJobs = await this.queue.getByTypeAndDedupeKeys<EmbeddingQueuePayload>(
      EMBEDDING_REINDEX_JOB_TYPE,
      documentIds
    )
    const existingById = new Map(existingJobs.map((job) => [job.payload.documentId, job.payload]))

    for (const documentId of documentIds) {
      const existing = existingById.get(documentId)

      const nextPayload: EmbeddingQueuePayload = existing
        ? {
            documentId,
            firstQueuedAt: existing.firstQueuedAt,
            lastQueuedAt: queuedAt > existing.lastQueuedAt ? queuedAt : existing.lastQueuedAt + 1,
            debounceUntil:
              queuedAt > existing.lastQueuedAt
                ? debounceUntil
                : existing.lastQueuedAt + 1 + (debounceUntil - queuedAt),
          }
        : {
            documentId,
            firstQueuedAt: queuedAt,
            lastQueuedAt: queuedAt,
            debounceUntil,
          }

      await this.queue.upsertUnique({
        type: EMBEDDING_REINDEX_JOB_TYPE,
        dedupeKey: documentId,
        payload: nextPayload,
        runAt: nextPayload.debounceUntil,
      })
    }
  }

  async listQueuedDocuments(): Promise<DocumentEmbeddingJobEntity[]> {
    const jobs = await this.queue.listQueuedByType<EmbeddingQueuePayload>(
      EMBEDDING_REINDEX_JOB_TYPE
    )
    return jobs
      .map((job) => job.payload)
      .sort((left, right) =>
        left.firstQueuedAt === right.firstQueuedAt
          ? left.debounceUntil - right.debounceUntil
          : left.firstQueuedAt - right.firstQueuedAt
      )
  }

  async getQueuedDocument(documentId: string): Promise<DocumentEmbeddingJobEntity | undefined> {
    const job = await this.queue.getByTypeAndDedupeKey<EmbeddingQueuePayload>(
      EMBEDDING_REINDEX_JOB_TYPE,
      documentId
    )
    return job?.payload
  }

  async clearQueuedDocuments(documentIds: string[]): Promise<void> {
    await this.queue.deleteQueuedByTypeAndDedupeKeys(EMBEDDING_REINDEX_JOB_TYPE, documentIds)
  }

  async getQueueStats(): Promise<DocumentEmbeddingQueueStats> {
    const stats = await this.queue.getTypeStats(EMBEDDING_REINDEX_JOB_TYPE)

    return {
      totalJobs: stats.totalQueued,
      oldestQueuedAt: stats.oldestQueuedAt,
      nextDebounceUntil: stats.nextAvailableAt,
    }
  }

  async findEmbeddings(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<DocumentEmbeddingEntity[]> {
    const rows = this.connection.all<EmbeddingRow>(
      `SELECT id, documentId, providerConfigId, providerId, type, baseUrl, model,
              strategyType, strategyProperties, chunkOrdinal, chunkStart, chunkEnd,
              selectionFrom, selectionTo, chunkText,
              dimensions, documentTimestamp, contentHash, createdAt, updatedAt
       FROM document_embeddings
       WHERE documentId = ? AND baseUrl = ? AND model = ?`,
      [documentId, normalizeBaseURL(baseURL), model.trim()]
    )

    return rows.sort((left, right) => left.chunkOrdinal - right.chunkOrdinal).map(toEmbeddingEntity)
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
      scope: { kind: 'project', projectId: input.projectId },
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
        const staleRows = this.connection.all<EmbeddingRow>(
          `SELECT id, documentId, providerConfigId, providerId, type, baseUrl, model,
                  strategyType, strategyProperties, chunkOrdinal, chunkStart, chunkEnd,
                  selectionFrom, selectionTo, chunkText,
                  dimensions, documentTimestamp, contentHash, createdAt, updatedAt
             FROM document_embeddings
            WHERE documentId = ? AND baseUrl = ? AND model = ?
            ORDER BY chunkOrdinal ASC`,
          [input.documentId, normalizedBaseURL, model]
        )

        return {
          status: 'stale',
          embeddings: staleRows.map(toEmbeddingEntity),
        }
      }

      const existing = this.connection.all<Pick<EmbeddingRow, 'id' | 'dimensions'>>(
        `SELECT id, dimensions
         FROM document_embeddings
         WHERE documentId = ? AND baseUrl = ? AND model = ?`,
        [input.documentId, normalizedBaseURL, model]
      )

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

        this.connection.run(
          `INSERT INTO document_embeddings
            (
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
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
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

        const row = this.connection.get<Pick<EmbeddingRow, 'id'>>(
          `SELECT id
             FROM document_embeddings
            WHERE documentId = ? AND baseUrl = ? AND model = ? AND chunkOrdinal = ?`,
          [input.documentId, normalizedBaseURL, model, chunk.ordinal]
        )

        if (!row) {
          throw new Error('Failed to read stored document embedding chunk.')
        }

        this.connection.exec(
          `CREATE VIRTUAL TABLE IF NOT EXISTS ${targetTable} USING vec0(embedding float[${dimensions}] distance_metric=cosine)`
        )
        this.connection.run(`DELETE FROM ${targetTable} WHERE rowid = ?`, [row.id])
        this.connection.run(`INSERT INTO ${targetTable} (rowid, embedding) VALUES (?, ?)`, [
          row.id,
          new Float32Array(chunk.embedding),
        ])
      }

      const rows = this.connection.all<EmbeddingRow>(
        `SELECT id, documentId, providerConfigId, providerId, type, baseUrl, model,
                strategyType, strategyProperties, chunkOrdinal, chunkStart, chunkEnd,
                selectionFrom, selectionTo, chunkText,
                dimensions, documentTimestamp, contentHash, createdAt, updatedAt
           FROM document_embeddings
          WHERE documentId = ? AND baseUrl = ? AND model = ?
          ORDER BY chunkOrdinal ASC`,
        [input.documentId, normalizedBaseURL, model]
      )

      return {
        status: 'applied',
        embeddings: rows.map(toEmbeddingEntity),
      }
    })
  }

  async deleteEmbeddingsByDocumentId(documentId: string): Promise<void> {
    const rows = this.connection.all<Pick<EmbeddingRow, 'id' | 'dimensions'>>(
      'SELECT id, dimensions FROM document_embeddings WHERE documentId = ?',
      [documentId]
    )

    this.connection.transaction(() => {
      for (const row of rows) {
        this.connection.run(`DELETE FROM ${vectorTableName(row.dimensions)} WHERE rowid = ?`, [
          row.id,
        ])
      }
      this.connection.run('DELETE FROM document_embeddings WHERE documentId = ?', [documentId])
    })

    await this.queue.deleteQueuedByTypeAndDedupeKeys(EMBEDDING_REINDEX_JOB_TYPE, [documentId])

    const uniqueDimensions = Array.from(new Set(rows.map((row) => row.dimensions)))
    for (const dimensions of uniqueDimensions) {
      const table = vectorTableName(dimensions)
      const countRow = this.connection.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${table}`,
        []
      )
      if ((countRow?.count ?? 0) === 0) {
        this.connection.exec(`DROP TABLE IF EXISTS ${table}`)
      }
    }
  }
}
