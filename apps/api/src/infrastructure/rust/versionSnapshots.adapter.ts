import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  VersionSnapshotsRepositoryPort,
  VersionSnapshotRow,
  VersionSnapshotMetaRow,
  VersionSnapshotCursorRow,
} from '../../core/ports/versionSnapshots.port.js'
import { currentTxId } from './tx-scope.js'
import {
  versionSnapshotCursorFromDto,
  versionSnapshotFromDto,
  versionSnapshotMetaFromDto,
  versionSnapshotToDto,
} from './mappers.js'

export class VersionSnapshotsRepository implements VersionSnapshotsRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async findById(id: string): Promise<VersionSnapshotRow | undefined> {
    const row = await this.engine.versionSnapshotsFindById(currentTxId(), id)
    return row ? versionSnapshotFromDto(row) : undefined
  }

  async findMetadataByDocumentId(documentId: string): Promise<VersionSnapshotMetaRow[]> {
    const rows = await this.engine.versionSnapshotsFindMetadataByDocumentId(
      currentTxId(),
      documentId
    )
    return rows.map(versionSnapshotMetaFromDto)
  }

  async findCursorById(
    documentId: string,
    id: string
  ): Promise<VersionSnapshotCursorRow | undefined> {
    const row = await this.engine.versionSnapshotsFindCursorById(currentTxId(), documentId, id)
    return row ? versionSnapshotCursorFromDto(row) : undefined
  }

  async insert(row: Omit<VersionSnapshotRow, 'createdAt'> & { createdAt?: number }): Promise<void> {
    await this.engine.versionSnapshotsInsert(currentTxId(), versionSnapshotToDto(row))
  }

  async deleteSnapshotsAfterCursor(
    documentId: string,
    cursorCreatedAt: number,
    cursorRowId: number
  ): Promise<void> {
    await this.engine.versionSnapshotsDeleteSnapshotsAfterCursor(
      currentTxId(),
      documentId,
      cursorCreatedAt,
      cursorRowId
    )
  }
}
