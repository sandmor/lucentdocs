import type { DocumentNoteRecord } from '@lucentdocs/shared'
import type { RepositorySet } from '../ports/types.js'

export interface DocumentNotesService {
  listByDocumentId(documentId: string): Promise<DocumentNoteRecord[]>
}

export function createDocumentNotesService(repos: RepositorySet): DocumentNotesService {
  return {
    listByDocumentId(documentId: string): Promise<DocumentNoteRecord[]> {
      return repos.documentNotes.listByDocumentId(documentId)
    },
  }
}
