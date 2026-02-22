import { getDb } from '../client.js'
import { toJsonField, fromJsonField, toOptionalJsonField } from '../utils.js'
import type { Document, JsonObject } from '@plotline/shared'

export type DocumentRow = {
  id: string
  title: string
  type: string
  metadata: string | null
  createdAt: number
  updatedAt: number
}

function toRow(doc: Document): DocumentRow {
  return {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    metadata: toJsonField(doc.metadata),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

function fromRow(row: DocumentRow): Document {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    metadata: fromJsonField(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function insert(doc: Document): Promise<void> {
  const db = await getDb()
  const row = toRow(doc)
  await db.run(
    `INSERT INTO documents (id, title, type, metadata, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.id, row.title, row.type, row.metadata, row.createdAt, row.updatedAt]
  )
}

export async function findById(id: string): Promise<Document | undefined> {
  const db = await getDb()
  const row = await db.get<DocumentRow>(`SELECT * FROM documents WHERE id = ?`, [id])
  return row ? fromRow(row) : undefined
}

export async function findByIds(ids: string[]): Promise<Document[]> {
  if (ids.length === 0) return []

  const db = await getDb()
  const placeholders = ids.map(() => '?').join(',')
  const rows = await db.all<DocumentRow[]>(
    `SELECT * FROM documents WHERE id IN (${placeholders})`,
    ids
  )
  return rows.map(fromRow)
}

export async function update(
  id: string,
  data: {
    title?: string
    metadata?: JsonObject | null
    updatedAt: number
  }
): Promise<void> {
  const db = await getDb()
  const metadataStr = toOptionalJsonField(data.metadata)
  const hasTitle = data.title !== undefined ? 1 : 0
  const hasMetadata = data.metadata !== undefined ? 1 : 0

  await db.run(
    `UPDATE documents
     SET title = CASE WHEN ? = 1 THEN ? ELSE title END,
         metadata = CASE WHEN ? = 1 THEN ? ELSE metadata END,
         updatedAt = ?
     WHERE id = ?`,
    [hasTitle, data.title ?? null, hasMetadata, metadataStr ?? null, data.updatedAt, id]
  )
}

export async function deleteById(id: string): Promise<void> {
  const db = await getDb()
  await db.run(`DELETE FROM documents WHERE id = ?`, [id])
}
