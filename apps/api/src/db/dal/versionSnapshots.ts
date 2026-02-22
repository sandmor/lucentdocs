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
