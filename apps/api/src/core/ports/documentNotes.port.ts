import type { DocumentNoteRecord } from '@lucentdocs/shared'

export interface DocumentNotesRepositoryPort {
  listByDocumentId(documentId: string): Promise<DocumentNoteRecord[]>
  replaceAllForDocument(documentId: string, notes: DocumentNoteRecord[]): Promise<void>
  deleteByDocumentId(documentId: string): Promise<void>
}
