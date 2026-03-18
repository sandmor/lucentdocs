import type { Document } from '@lucentdocs/shared'
import type {
  DocumentsRepositoryPort,
  UpdateDocumentData,
} from '../../core/ports/documents.port.js'
import type { SqliteConnection } from './connection.js'
import { toJsonField, fromJsonField, toOptionalJsonField } from './utils.js'

interface DocumentRow {
  id: string
  title: string
  type: string
  metadata: string | null
  createdAt: number
  updatedAt: number
}

function toRow(doc: Document): DocumentRow {
  return {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    metadata: toJsonField(doc.metadata),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

function fromRow(row: DocumentRow): Document {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    metadata: fromJsonField(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class DocumentsRepository implements DocumentsRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  async findById(id: string): Promise<Document | undefined> {
    const row = this.connection.get<DocumentRow>('SELECT * FROM documents WHERE id = ?', [id])
    return row ? fromRow(row) : undefined
  }

  async findByIds(ids: string[]): Promise<Document[]> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id.length > 0)))
    if (uniqueIds.length === 0) return []

    const rows = this.connection.all<DocumentRow>(
      `WITH requested AS (
         SELECT value AS id
           FROM json_each(?)
       )
       SELECT d.*
         FROM documents AS d
         JOIN requested ON requested.id = d.id`,
      [JSON.stringify(uniqueIds)]
    )
    return rows.map(fromRow)
  }

  async insert(document: Document): Promise<void> {
    const row = toRow(document)
    this.connection.run(
      'INSERT INTO documents (id, title, type, metadata, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      [row.id, row.title, row.type, row.metadata, row.createdAt, row.updatedAt]
    )
  }

  async update(id: string, data: UpdateDocumentData): Promise<void> {
    const metadataStr = toOptionalJsonField(data.metadata)
    const hasTitle = data.title !== undefined ? 1 : 0
    const hasMetadata = data.metadata !== undefined ? 1 : 0

    this.connection.run(
      `UPDATE documents
       SET title = CASE WHEN ? = 1 THEN ? ELSE title END,
           metadata = CASE WHEN ? = 1 THEN ? ELSE metadata END,
           updatedAt = ?
       WHERE id = ?`,
      [hasTitle, data.title ?? null, hasMetadata, metadataStr ?? null, data.updatedAt, id]
    )
  }

  async deleteById(id: string): Promise<void> {
    this.connection.run('DELETE FROM documents WHERE id = ?', [id])
  }
}
