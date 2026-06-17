import type { DocumentNoteRecord } from '@lucentdocs/shared'
import type { NativeStorageEngine } from '@lucentdocs/core'
import type { DocumentNotesRepositoryPort } from '../../core/ports/documentNotes.port.js'
import { currentTxId } from './tx-scope.js'
import { documentNoteFromDto, documentNoteToDto } from './mappers.js'

export class DocumentNotesRepository implements DocumentNotesRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async listByDocumentId(documentId: string): Promise<DocumentNoteRecord[]> {
    const rows = await this.engine.documentNotesListByDocumentId(currentTxId(), documentId)
    return rows.map(documentNoteFromDto)
  }

  async replaceAllForDocument(documentId: string, notes: DocumentNoteRecord[]): Promise<void> {
    await this.engine.documentNotesReplaceAllForDocument(
      currentTxId(),
      documentId,
      notes.map((note) => documentNoteToDto({ ...note, documentId }))
    )
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.engine.documentNotesDeleteByDocumentId(currentTxId(), documentId)
  }
}
