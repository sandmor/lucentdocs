import { getDb } from '../client.js'
import { toJsonField, fromJsonField, toOptionalJsonField } from '../utils.js'
import type { JsonObject, Project } from '@plotline/shared'

export type ProjectRow = {
  id: string
  title: string
  metadata: string | null
  createdAt: number
  updatedAt: number
}

function toRow(project: Project): ProjectRow {
  return {
    id: project.id,
    title: project.title,
    metadata: toJsonField(project.metadata),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

function fromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    metadata: fromJsonField(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function insert(project: Project): Promise<void> {
  const db = await getDb()
  const row = toRow(project)
  await db.run(
    `INSERT INTO projects (id, title, metadata, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`,
    [row.id, row.title, row.metadata, row.createdAt, row.updatedAt]
  )
}

export async function findAll(): Promise<Project[]> {
  const db = await getDb()
  const rows = await db.all<ProjectRow[]>(`SELECT * FROM projects ORDER BY updatedAt DESC`)
  return rows.map(fromRow)
}

export async function findById(id: string): Promise<Project | undefined> {
  const db = await getDb()
  const row = await db.get<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, [id])
  return row ? fromRow(row) : undefined
}

export async function update(
  id: string,
  data: { title?: string; metadata?: JsonObject | null; updatedAt: number }
): Promise<void> {
  const db = await getDb()
  const metadataStr = toOptionalJsonField(data.metadata)
  const hasTitle = data.title !== undefined ? 1 : 0
  const hasMetadata = data.metadata !== undefined ? 1 : 0

  await db.run(
    `UPDATE projects
     SET title = CASE WHEN ? = 1 THEN ? ELSE title END,
         metadata = CASE WHEN ? = 1 THEN ? ELSE metadata END,
         updatedAt = ?
     WHERE id = ?`,
    [hasTitle, data.title ?? null, hasMetadata, metadataStr ?? null, data.updatedAt, id]
  )
}

export async function deleteById(id: string): Promise<void> {
  const db = await getDb()
  await db.run(`DELETE FROM projects WHERE id = ?`, [id])
}
