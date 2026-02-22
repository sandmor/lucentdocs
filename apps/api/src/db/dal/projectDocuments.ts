import { getDb } from '../client.js'

export type ProjectDocumentRow = {
  projectId: string
  documentId: string
  addedAt: number
}

export async function insert(row: ProjectDocumentRow): Promise<void> {
  const db = await getDb()
  await db.run(
    `INSERT INTO project_documents (projectId, documentId, addedAt)
     VALUES (?, ?, ?)`,
    [row.projectId, row.documentId, row.addedAt]
  )
}

export async function findSoleDocumentIdsByProjectId(projectId: string): Promise<string[]> {
  const db = await getDb()
  const rows = await db.all<Array<{ documentId: string }>>(
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

export async function findSoleProjectIdByDocumentId(documentId: string): Promise<string | undefined> {
  const db = await getDb()
  const row = await db.get<{ projectId: string }>(
    `SELECT MIN(projectId) AS projectId
       FROM project_documents
      WHERE documentId = ?
      GROUP BY documentId
      HAVING COUNT(DISTINCT projectId) = 1`,
    [documentId]
  )

  return row?.projectId
}
