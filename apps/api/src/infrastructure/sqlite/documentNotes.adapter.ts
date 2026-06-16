import type { DocumentNoteRecord } from '@lucentdocs/shared'
import type { DocumentNotesRepositoryPort } from '../../core/ports/documentNotes.port.js'
import type { SqliteConnection } from './connection.js'

export class DocumentNotesRepository implements DocumentNotesRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  async listByDocumentId(documentId: string): Promise<DocumentNoteRecord[]> {
    return this.connection.all<DocumentNoteRecord>(
      `SELECT id, documentId, blockId, placement, content, authorUserId, createdAt, updatedAt
       FROM document_notes
       WHERE documentId = ?
       ORDER BY createdAt ASC`,
      [documentId]
    )
  }

  async replaceAllForDocument(documentId: string, notes: DocumentNoteRecord[]): Promise<void> {
    this.connection.transaction(() => {
      this.connection.run('DELETE FROM document_notes WHERE documentId = ?', [documentId])
      for (const note of notes) {
        this.connection.run(
          `INSERT INTO document_notes (
             id, documentId, blockId, placement, content, authorUserId, createdAt, updatedAt
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            note.id,
            documentId,
            note.blockId,
            note.placement,
            note.content,
            note.authorUserId,
            note.createdAt,
            note.updatedAt,
          ]
        )
      }
    })
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    this.connection.run('DELETE FROM document_notes WHERE documentId = ?', [documentId])
  }
}
