import { getDb } from '../client.js'

export interface ChatThreadRow {
  id: string
  projectId: string
  documentId: string
  title: string
  messages: string
  createdAt: number
  updatedAt: number
}

export async function insert(row: ChatThreadRow): Promise<void> {
  const db = await getDb()
  await db.run(
    `INSERT INTO chat_threads (id, projectId, documentId, title, messages, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.projectId, row.documentId, row.title, row.messages, row.createdAt, row.updatedAt]
  )
}

export async function update(
  projectId: string,
  documentId: string,
  id: string,
  patch: { title?: string; messages?: string; updatedAt: number }
): Promise<boolean> {
  const db = await getDb()
  const clauses: string[] = []
  const params: unknown[] = []

  if (patch.title !== undefined) {
    clauses.push('title = ?')
    params.push(patch.title)
  }
  if (patch.messages !== undefined) {
    clauses.push('messages = ?')
    params.push(patch.messages)
  }

  clauses.push('updatedAt = ?')
  params.push(patch.updatedAt)
  params.push(projectId, documentId, id)

  const result = await db.run(
    `UPDATE chat_threads
     SET ${clauses.join(', ')}
     WHERE projectId = ? AND documentId = ? AND id = ?`,
    params
  )
  return (result.changes ?? 0) > 0
}

export async function findById(
  projectId: string,
  documentId: string,
  id: string
): Promise<ChatThreadRow | undefined> {
  const db = await getDb()
  return await db.get<ChatThreadRow>(
    `SELECT id, projectId, documentId, title, messages, createdAt, updatedAt
     FROM chat_threads
     WHERE projectId = ? AND documentId = ? AND id = ?`,
    [projectId, documentId, id]
  )
}

export async function listByDocument(
  projectId: string,
  documentId: string
): Promise<ChatThreadRow[]> {
  const db = await getDb()
  return await db.all<ChatThreadRow[]>(
    `SELECT id, projectId, documentId, title, messages, createdAt, updatedAt
     FROM chat_threads
     WHERE projectId = ? AND documentId = ?
     ORDER BY updatedAt DESC, createdAt DESC`,
    [projectId, documentId]
  )
}

export async function deleteById(
  projectId: string,
  documentId: string,
  id: string
): Promise<boolean> {
  const db = await getDb()
  const result = await db.run(
    `DELETE FROM chat_threads
     WHERE projectId = ? AND documentId = ? AND id = ?`,
    [projectId, documentId, id]
  )
  return (result.changes ?? 0) > 0
}
