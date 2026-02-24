export interface ProjectDocumentRow {
  projectId: string
  documentId: string
  addedAt: number
}

export interface ProjectDocumentsRepositoryPort {
  insert(row: ProjectDocumentRow): Promise<void>
  findSoleDocumentIdsByProjectId(projectId: string): Promise<string[]>
  findSoleProjectIdByDocumentId(documentId: string): Promise<string | undefined>
}
