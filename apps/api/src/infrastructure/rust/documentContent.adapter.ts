import type { JsonObject } from '@lucentdocs/shared'
import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  DocumentContentRepositoryPort,
  DocumentContentRow,
} from '../../core/ports/documentContent.port.js'
import { currentTxId } from './tx-scope.js'
import { documentContentFromDto } from './mappers.js'

export class DocumentContentRepository implements DocumentContentRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async findByDocumentId(documentId: string): Promise<DocumentContentRow | undefined> {
    const row = await this.engine.documentContentFindByDocumentId(currentTxId(), documentId)
    return row ? documentContentFromDto(row) : undefined
  }

  async upsert(
    documentId: string,
    content: JsonObject,
    updatedAt: number = Date.now()
  ): Promise<void> {
    await this.engine.documentContentUpsert(
      currentTxId(),
      documentId,
      JSON.stringify(content),
      updatedAt
    )
  }

  async delete(documentId: string): Promise<void> {
    await this.engine.documentContentDelete(currentTxId(), documentId)
  }
}
