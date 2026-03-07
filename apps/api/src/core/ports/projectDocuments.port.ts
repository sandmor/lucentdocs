export interface ProjectDocumentRow {
  projectId: string
  documentId: string
  addedAt: number
}

export interface ProjectDocumentsRepositoryPort {
  insert(row: ProjectDocumentRow): Promise<void>
  hasProjectDocument(projectId: string, documentId: string): Promise<boolean>
  listDocumentIds(): Promise<string[]>
  findSoleDocumentIdsByProjectId(projectId: string): Promise<string[]>
  findProjectIdsByDocumentId(documentId: string): Promise<string[]>
  findSoleProjectIdByDocumentId(documentId: string): Promise<string | undefined>
}
