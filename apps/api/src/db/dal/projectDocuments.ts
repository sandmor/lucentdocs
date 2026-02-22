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

export async function findDocumentByProjectId(
  projectId: string
): Promise<ProjectDocumentRow | undefined> {
  const db = await getDb()
  return db.get<ProjectDocumentRow>(
    `SELECT *
       FROM project_documents
      WHERE projectId = ?
      ORDER BY addedAt DESC
      LIMIT 1`,
    [projectId]
  )
}

export async function findLatestDocumentsByProjectIds(
  projectIds: string[]
): Promise<ProjectDocumentRow[]> {
  if (projectIds.length === 0) return []

  const db = await getDb()
  const placeholders = projectIds.map(() => '?').join(',')
  const rows = await db.all<ProjectDocumentRow[]>(
    `SELECT projectId, documentId, addedAt
       FROM project_documents
      WHERE projectId IN (${placeholders})
      ORDER BY projectId ASC, addedAt DESC`,
    projectIds
  )

  const latestByProject = new Map<string, ProjectDocumentRow>()
  for (const row of rows) {
    if (!latestByProject.has(row.projectId)) {
      latestByProject.set(row.projectId, row)
    }
  }

  return [...latestByProject.values()]
}
