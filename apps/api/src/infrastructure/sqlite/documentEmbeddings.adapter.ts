import type {
  DocumentEmbeddingEntity,
  DocumentEmbeddingJobEntity,
  DocumentEmbeddingQueueStats,
  DocumentEmbeddingsRepositoryPort,
  UpsertDocumentEmbeddingInput,
} from '../../core/ports/documentEmbeddings.port.js'
import { normalizeModelSourceType, normalizeBaseURL } from '../../core/ai/provider-types.js'
import type { SqliteConnection } from './connection.js'

const MAX_EMBEDDING_DIMENSIONS = 8192

interface EmbeddingJobRow {
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
  dimensions: number
  contentHash: string
  createdAt: number
  updatedAt: number
}

interface QueueStatsRow {
  totalJobs: number
  oldestQueuedAt: number | null
  nextDebounceUntil: number | null
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

function toEmbeddingEntity(row: EmbeddingRow): DocumentEmbeddingEntity {
  return {
    id: row.id,
    documentId: row.documentId,
    providerConfigId: row.providerConfigId,
    providerId: row.providerId,
    type: normalizeModelSourceType(row.type),
    baseURL: row.baseUrl,
    model: row.model,
    dimensions: row.dimensions,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class DocumentEmbeddingsRepository implements DocumentEmbeddingsRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  async enqueueDocument(
    documentId: string,
    queuedAt: number,
    debounceUntil: number
  ): Promise<void> {
    this.connection.run(
      `INSERT INTO document_embedding_jobs (documentId, firstQueuedAt, lastQueuedAt, debounceUntil)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(documentId) DO UPDATE SET
         lastQueuedAt = CASE
           WHEN excluded.lastQueuedAt > document_embedding_jobs.lastQueuedAt
             THEN excluded.lastQueuedAt
           ELSE document_embedding_jobs.lastQueuedAt + 1
         END,
         debounceUntil = CASE
           WHEN excluded.lastQueuedAt > document_embedding_jobs.lastQueuedAt
             THEN excluded.debounceUntil
           ELSE (document_embedding_jobs.lastQueuedAt + 1) + (excluded.debounceUntil - excluded.lastQueuedAt)
         END`,
      [documentId, queuedAt, queuedAt, debounceUntil]
    )
  }

  async listQueuedDocuments(): Promise<DocumentEmbeddingJobEntity[]> {
    return this.connection.all<EmbeddingJobRow>(
      `SELECT documentId, firstQueuedAt, lastQueuedAt, debounceUntil
       FROM document_embedding_jobs
       ORDER BY firstQueuedAt ASC, debounceUntil ASC`,
      []
    )
  }

  async getQueuedDocument(documentId: string): Promise<DocumentEmbeddingJobEntity | undefined> {
    return this.connection.get<EmbeddingJobRow>(
      `SELECT documentId, firstQueuedAt, lastQueuedAt, debounceUntil
       FROM document_embedding_jobs
       WHERE documentId = ?`,
      [documentId]
    )
  }

  async clearQueuedDocuments(documentIds: string[]): Promise<void> {
    if (documentIds.length === 0) return
    const placeholders = documentIds.map(() => '?').join(', ')
    this.connection.run(
      `DELETE FROM document_embedding_jobs WHERE documentId IN (${placeholders})`,
      documentIds
    )
  }

  async getQueueStats(): Promise<DocumentEmbeddingQueueStats> {
    const row = this.connection.get<QueueStatsRow>(
      `SELECT
         COUNT(*) AS totalJobs,
         MIN(firstQueuedAt) AS oldestQueuedAt,
         MIN(debounceUntil) AS nextDebounceUntil
       FROM document_embedding_jobs`,
      []
    )

    return {
      totalJobs: row?.totalJobs ?? 0,
      oldestQueuedAt: row?.oldestQueuedAt ?? null,
      nextDebounceUntil: row?.nextDebounceUntil ?? null,
    }
  }

  async findEmbedding(
    documentId: string,
    baseURL: string,
    model: string
  ): Promise<DocumentEmbeddingEntity | undefined> {
    const row = this.connection.get<EmbeddingRow>(
      `SELECT id, documentId, providerConfigId, providerId, type, baseUrl, model, dimensions, contentHash, createdAt, updatedAt
       FROM document_embeddings
       WHERE documentId = ? AND baseUrl = ? AND model = ?`,
      [documentId, normalizeBaseURL(baseURL), model.trim()]
    )

    return row ? toEmbeddingEntity(row) : undefined
  }

  async upsertEmbedding(input: UpsertDocumentEmbeddingInput): Promise<DocumentEmbeddingEntity> {
    validateEmbeddingVector(input.embedding)
    const normalizedBaseURL = normalizeBaseURL(input.baseURL)
    const model = input.model.trim()
    const dimensions = input.embedding.length
    const targetTable = vectorTableName(dimensions)

    return this.connection.transaction(() => {
      const existing = this.connection.get<EmbeddingRow>(
        `SELECT id, documentId, providerConfigId, providerId, type, baseUrl, model, dimensions, contentHash, createdAt, updatedAt
         FROM document_embeddings
         WHERE documentId = ? AND baseUrl = ? AND model = ?`,
        [input.documentId, normalizedBaseURL, model]
      )

      if (existing && existing.dimensions !== dimensions) {
        this.connection.run(`DELETE FROM ${vectorTableName(existing.dimensions)} WHERE rowid = ?`, [
          existing.id,
        ])
      }

      if (existing) {
        this.connection.run(
          `UPDATE document_embeddings
           SET providerConfigId = ?,
               providerId = ?,
               type = ?,
               dimensions = ?,
               contentHash = ?,
               updatedAt = ?
           WHERE id = ?`,
          [
            input.providerConfigId,
            input.providerId,
            input.type,
            dimensions,
            input.contentHash,
            input.updatedAt,
            existing.id,
          ]
        )
      } else {
        this.connection.run(
          `INSERT INTO document_embeddings
            (documentId, providerConfigId, providerId, type, baseUrl, model, dimensions, contentHash, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.documentId,
            input.providerConfigId,
            input.providerId,
            input.type,
            normalizedBaseURL,
            model,
            dimensions,
            input.contentHash,
            input.createdAt,
            input.updatedAt,
          ]
        )
      }

      const row = this.connection.get<EmbeddingRow>(
        `SELECT id, documentId, providerConfigId, providerId, type, baseUrl, model, dimensions, contentHash, createdAt, updatedAt
         FROM document_embeddings
         WHERE documentId = ? AND baseUrl = ? AND model = ?`,
        [input.documentId, normalizedBaseURL, model]
      )

      if (!row) {
        throw new Error('Failed to read stored document embedding.')
      }

      this.connection.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${targetTable} USING vec0(embedding float[${dimensions}] distance_metric=cosine)`
      )
      this.connection.run(`DELETE FROM ${targetTable} WHERE rowid = ?`, [row.id])
      this.connection.run(`INSERT INTO ${targetTable} (rowid, embedding) VALUES (?, ?)`, [
        row.id,
        new Float32Array(input.embedding),
      ])

      return toEmbeddingEntity(row)
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
      this.connection.run('DELETE FROM document_embedding_jobs WHERE documentId = ?', [documentId])
    })

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
