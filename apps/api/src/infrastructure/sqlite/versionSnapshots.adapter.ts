import type {
  VersionSnapshotsRepositoryPort,
  VersionSnapshotRow,
  VersionSnapshotMetaRow,
  VersionSnapshotCursorRow,
} from '../../core/ports/versionSnapshots.port.js'
import type { SqliteConnection } from './connection.js'

export class VersionSnapshotsRepository implements VersionSnapshotsRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  async findById(id: string): Promise<VersionSnapshotRow | undefined> {
    return this.connection.get<VersionSnapshotRow>('SELECT * FROM version_snapshots WHERE id = ?', [
      id,
    ])
  }

  async findMetadataByDocumentId(documentId: string): Promise<VersionSnapshotMetaRow[]> {
    return this.connection.all<VersionSnapshotMetaRow>(
      'SELECT id, documentId, createdAt FROM version_snapshots WHERE documentId = ? ORDER BY createdAt DESC',
      [documentId]
    )
  }

  async findCursorById(
    documentId: string,
    id: string
  ): Promise<VersionSnapshotCursorRow | undefined> {
    return this.connection.get<VersionSnapshotCursorRow>(
      'SELECT id, documentId, content, createdAt, rowid AS rowId FROM version_snapshots WHERE id = ? AND documentId = ?',
      [id, documentId]
    )
  }

  async insert(row: Omit<VersionSnapshotRow, 'createdAt'> & { createdAt?: number }): Promise<void> {
    this.connection.run(
      'INSERT INTO version_snapshots (id, documentId, content, createdAt) VALUES (?, ?, ?, ?)',
      [row.id, row.documentId, row.content, row.createdAt ?? Date.now()]
    )
  }

  async deleteSnapshotsAfterCursor(
    documentId: string,
    cursorCreatedAt: number,
    cursorRowId: number
  ): Promise<void> {
    this.connection.run(
      `DELETE FROM version_snapshots
       WHERE documentId = ?
         AND (
           createdAt > ?
           OR (createdAt = ? AND rowid > ?)
         )`,
      [documentId, cursorCreatedAt, cursorCreatedAt, cursorRowId]
    )
  }
}
