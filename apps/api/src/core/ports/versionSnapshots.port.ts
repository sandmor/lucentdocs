export interface VersionSnapshotRow {
  id: string
  documentId: string
  content: string
  createdAt: number
}

export interface VersionSnapshotMetaRow {
  id: string
  documentId: string
  createdAt: number
}

export interface VersionSnapshotCursorRow extends VersionSnapshotRow {
  rowId: number
}

export interface VersionSnapshotsRepositoryPort {
  findById(id: string): Promise<VersionSnapshotRow | undefined>
  findMetadataByDocumentId(documentId: string): Promise<VersionSnapshotMetaRow[]>
  findCursorById(documentId: string, id: string): Promise<VersionSnapshotCursorRow | undefined>
  insert(row: Omit<VersionSnapshotRow, 'createdAt'> & { createdAt?: number }): Promise<void>
  deleteSnapshotsAfterCursor(
    documentId: string,
    cursorCreatedAt: number,
    cursorRowId: number
  ): Promise<void>
}
