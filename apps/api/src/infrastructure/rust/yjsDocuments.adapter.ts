import type { NativeStorageEngine } from '@lucentdocs/core'
import type { YjsDocumentsRepositoryPort } from '../../core/ports/yjsDocuments.port.js'
import { docs } from '@y/websocket-server/utils'
import * as Y from 'yjs'
import { currentTxId } from './tx-scope.js'

export class YjsDocumentsRepository implements YjsDocumentsRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async getPersisted(documentId: string): Promise<Buffer | null> {
    return this.engine.yjsGetPersisted(currentTxId(), documentId)
  }

  async getLatest(documentId: string): Promise<Buffer | null> {
    const liveDoc = docs.get(documentId)
    if (liveDoc) {
      return Buffer.from(Y.encodeStateAsUpdate(liveDoc))
    }
    return this.getPersisted(documentId)
  }

  async set(documentId: string, data: Buffer): Promise<void> {
    await this.engine.yjsSet(currentTxId(), documentId, data)
  }

  async delete(documentId: string): Promise<void> {
    await this.engine.yjsDelete(currentTxId(), documentId)
  }
}
