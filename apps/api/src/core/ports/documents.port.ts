import type { Document, JsonObject } from '@lucentdocs/shared'

export interface UpdateDocumentData {
  title?: string
  metadata?: JsonObject | null
  updatedAt: number
}

export interface DocumentsRepositoryPort {
  findById(id: string): Promise<Document | undefined>
  findByIds(ids: string[]): Promise<Document[]>
  insert(document: Document): Promise<void>
  update(id: string, data: UpdateDocumentData): Promise<void>
  deleteById(id: string): Promise<void>
}
