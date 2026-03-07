import type {
  ProjectDocumentsRepositoryPort,
  ProjectDocumentRow,
} from '../../core/ports/projectDocuments.port.js'
import type { SqliteConnection } from './connection.js'

export class ProjectDocumentsRepository implements ProjectDocumentsRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  async insert(row: ProjectDocumentRow): Promise<void> {
    this.connection.run(
      'INSERT INTO project_documents (projectId, documentId, addedAt) VALUES (?, ?, ?)',
      [row.projectId, row.documentId, row.addedAt]
    )
  }

  async hasProjectDocument(projectId: string, documentId: string): Promise<boolean> {
    const row = this.connection.get<{ found: number }>(
      `SELECT 1 AS found
         FROM project_documents
        WHERE projectId = ? AND documentId = ?
        LIMIT 1`,
      [projectId, documentId]
    )
    return row?.found === 1
  }

  async listDocumentIds(): Promise<string[]> {
    const rows = this.connection.all<{ documentId: string }>(
      `SELECT DISTINCT documentId
         FROM project_documents
        ORDER BY documentId ASC`,
      []
    )
    return rows.map((row) => row.documentId)
  }

  async findSoleDocumentIdsByProjectId(projectId: string): Promise<string[]> {
    const rows = this.connection.all<{ documentId: string }>(
      `SELECT pd.documentId
         FROM project_documents pd
        WHERE pd.projectId = ?
          AND NOT EXISTS (
            SELECT 1
              FROM project_documents other
             WHERE other.documentId = pd.documentId
               AND other.projectId <> ?
          )
        GROUP BY pd.documentId
        ORDER BY MAX(pd.addedAt) DESC`,
      [projectId, projectId]
    )
    return rows.map((row) => row.documentId)
  }

  async findProjectIdsByDocumentId(documentId: string): Promise<string[]> {
    const rows = this.connection.all<{ projectId: string }>(
      `SELECT DISTINCT projectId
         FROM project_documents
        WHERE documentId = ?
        ORDER BY addedAt DESC`,
      [documentId]
    )
    return rows.map((row) => row.projectId)
  }

  async findSoleProjectIdByDocumentId(documentId: string): Promise<string | undefined> {
    const row = this.connection.get<{ projectId: string }>(
      `SELECT MIN(projectId) AS projectId
         FROM project_documents
        WHERE documentId = ?
        GROUP BY documentId
        HAVING COUNT(DISTINCT projectId) = 1`,
      [documentId]
    )
    return row?.projectId
  }
}
