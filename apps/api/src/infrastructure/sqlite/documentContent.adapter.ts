import type { JsonObject } from '@lucentdocs/shared'
import type {
  DocumentContentRepositoryPort,
  DocumentContentRow,
} from '../../core/ports/documentContent.port.js'
import type { SqliteConnection } from './connection.js'

export class DocumentContentRepository implements DocumentContentRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  async findByDocumentId(documentId: string): Promise<DocumentContentRow | undefined> {
    return this.connection.get<DocumentContentRow>(
      'SELECT documentId, content, updatedAt FROM document_content WHERE documentId = ?',
      [documentId]
    )
  }

  async upsert(documentId: string, content: JsonObject, updatedAt: number = Date.now()): Promise<void> {
    this.connection.run(
      `INSERT INTO document_content (documentId, content, updatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(documentId) DO UPDATE SET
         content = excluded.content,
         updatedAt = excluded.updatedAt`,
      [documentId, JSON.stringify(content), updatedAt]
    )
  }

  async delete(documentId: string): Promise<void> {
    this.connection.run('DELETE FROM document_content WHERE documentId = ?', [documentId])
  }
}
