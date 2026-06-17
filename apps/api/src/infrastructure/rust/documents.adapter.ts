import type { Document } from '@lucentdocs/shared'
import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  DocumentsRepositoryPort,
  UpdateDocumentData,
} from '../../core/ports/documents.port.js'
import { currentTxId } from './tx-scope.js'
import { documentFromDto, documentToDto, updateDocumentToDto } from './mappers.js'

export class DocumentsRepository implements DocumentsRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async findById(id: string): Promise<Document | undefined> {
    const row = await this.engine.documentsFindById(currentTxId(), id)
    return row ? documentFromDto(row) : undefined
  }

  async findByIds(ids: string[]): Promise<Document[]> {
    const rows = await this.engine.documentsFindByIds(currentTxId(), ids)
    return rows.map(documentFromDto)
  }

  async insert(document: Document): Promise<void> {
    await this.engine.documentsInsert(currentTxId(), documentToDto(document))
  }

  async update(id: string, data: UpdateDocumentData): Promise<void> {
    await this.engine.documentsUpdate(currentTxId(), id, updateDocumentToDto(id, data))
  }

  async deleteById(id: string): Promise<void> {
    await this.engine.documentsDeleteById(currentTxId(), id)
  }
}
