export interface ProjectDocumentRow {
  projectId: string
  documentId: string
  path: string
  addedByUserId: string
  addedAt: number
  updatedAt: number
}

export interface ProjectDocumentsRepositoryPort {
  insert(row: ProjectDocumentRow): Promise<void>
  listByProject(projectId: string): Promise<ProjectDocumentRow[]>
  listByDocument(documentId: string): Promise<ProjectDocumentRow[]>
  updatePath(projectId: string, documentId: string, path: string, updatedAt: number): Promise<boolean>
  delete(projectId: string, documentId: string): Promise<boolean>
  hasProjectDocument(projectId: string, documentId: string): Promise<boolean>
  findAssociatedDocumentIds(projectId: string, documentIds: string[]): Promise<Set<string>>
  listDocumentIds(): Promise<string[]>
  findSoleDocumentIdsByProjectId(projectId: string): Promise<string[]>
  findProjectIdsByDocumentId(documentId: string): Promise<string[]>
  findSoleProjectIdByDocumentId(documentId: string): Promise<string | undefined>
  findSoleProjectIdsByDocumentIds(documentIds: string[]): Promise<Map<string, string>>
}
