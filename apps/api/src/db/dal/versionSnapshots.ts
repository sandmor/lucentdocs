import { getDb } from '../client.js'

export type VersionSnapshotRow = {
  id: string
  documentId: string
  content: string
  createdAt: number
}

export type VersionSnapshotMetaRow = {
  id: string
  documentId: string
  createdAt: number
}

export type VersionSnapshotCursorRow = VersionSnapshotRow & {
  rowId: number
}

export async function insert(
  row: Omit<VersionSnapshotRow, 'createdAt'> & { createdAt?: number }
): Promise<void> {
  const db = await getDb()
  await db.run(
    'INSERT INTO version_snapshots (id, documentId, content, createdAt) VALUES (?, ?, ?, ?)',
    [row.id, row.documentId, row.content, row.createdAt ?? Date.now()]
  )
}

export async function findMetadataByDocumentId(
  documentId: string
): Promise<VersionSnapshotMetaRow[]> {
  const db = await getDb()
  return db.all<VersionSnapshotMetaRow[]>(
    'SELECT id, documentId, createdAt FROM version_snapshots WHERE documentId = ? ORDER BY createdAt DESC',
    [documentId]
  )
}

export async function findById(id: string): Promise<VersionSnapshotRow | undefined> {
  const db = await getDb()
  return db.get<VersionSnapshotRow>('SELECT * FROM version_snapshots WHERE id = ?', [id])
}

export async function findCursorById(
  documentId: string,
  id: string
): Promise<VersionSnapshotCursorRow | undefined> {
  const db = await getDb()
  return db.get<VersionSnapshotCursorRow>(
    'SELECT id, documentId, content, createdAt, rowid AS rowId FROM version_snapshots WHERE id = ? AND documentId = ?',
    [id, documentId]
  )
}

export async function deleteSnapshotsAfterCursor(
  documentId: string,
  cursorCreatedAt: number,
  cursorRowId: number
): Promise<void> {
  const db = await getDb()
  await db.run(
    `DELETE FROM version_snapshots
     WHERE documentId = ?
       AND (
         createdAt > ?
         OR (createdAt = ? AND rowid > ?)
       )`,
    [documentId, cursorCreatedAt, cursorCreatedAt, cursorRowId]
  )
}
