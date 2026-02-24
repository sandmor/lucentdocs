export interface YjsDocumentsRepositoryPort {
  getPersisted(documentId: string): Promise<Buffer | null>
  getLatest(documentId: string): Promise<Buffer | null>
  set(documentId: string, data: Buffer): Promise<void>
  delete(documentId: string): Promise<void>
}
