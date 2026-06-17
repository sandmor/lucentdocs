import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  ProjectDocumentsRepositoryPort,
  ProjectDocumentRow,
} from '../../core/ports/projectDocuments.port.js'
import { currentTxId } from './tx-scope.js'
import { nullToUndefined, projectDocumentToDto } from './mappers.js'

export class ProjectDocumentsRepository implements ProjectDocumentsRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async insert(row: ProjectDocumentRow): Promise<void> {
    await this.engine.projectDocumentsInsert(currentTxId(), projectDocumentToDto(row))
  }

  async hasProjectDocument(projectId: string, documentId: string): Promise<boolean> {
    return this.engine.projectDocumentsHasProjectDocument(currentTxId(), projectId, documentId)
  }

  async findAssociatedDocumentIds(projectId: string, documentIds: string[]): Promise<Set<string>> {
    const rows = await this.engine.projectDocumentsFindAssociatedDocumentIds(
      currentTxId(),
      projectId,
      documentIds
    )
    return new Set(rows)
  }

  async listDocumentIds(): Promise<string[]> {
    return this.engine.projectDocumentsListDocumentIds(currentTxId())
  }

  async findSoleDocumentIdsByProjectId(projectId: string): Promise<string[]> {
    return this.engine.projectDocumentsFindSoleDocumentIdsByProjectId(currentTxId(), projectId)
  }

  async findProjectIdsByDocumentId(documentId: string): Promise<string[]> {
    return this.engine.projectDocumentsFindProjectIdsByDocumentId(currentTxId(), documentId)
  }

  async findSoleProjectIdByDocumentId(documentId: string): Promise<string | undefined> {
    const projectId = await this.engine.projectDocumentsFindSoleProjectIdByDocumentId(
      currentTxId(),
      documentId
    )
    return nullToUndefined(projectId)
  }

  async findSoleProjectIdsByDocumentIds(documentIds: string[]): Promise<Map<string, string>> {
    const record = await this.engine.projectDocumentsFindSoleProjectIdsByDocumentIds(
      currentTxId(),
      documentIds
    )
    return new Map(Object.entries(record))
  }
}
