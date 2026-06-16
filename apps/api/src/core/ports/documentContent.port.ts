import type { JsonObject } from '@lucentdocs/shared'

export interface DocumentContentRow {
  documentId: string
  content: string
  updatedAt: number
}

export interface DocumentContentRepositoryPort {
  findByDocumentId(documentId: string): Promise<DocumentContentRow | undefined>
  upsert(documentId: string, content: JsonObject, updatedAt?: number): Promise<void>
  delete(documentId: string): Promise<void>
}
