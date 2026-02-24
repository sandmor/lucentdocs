import type { YjsDocumentsRepositoryPort } from '../../core/ports/yjsDocuments.port.js'
import type { SqliteConnection } from './connection.js'
import { docs } from '@y/websocket-server/utils'
import * as Y from 'yjs'

export class YjsDocumentsRepository implements YjsDocumentsRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  async getPersisted(documentId: string): Promise<Buffer | null> {
    const row = this.connection.get<{ data: Buffer }>(
      'SELECT data FROM yjs_documents WHERE name = ?',
      [documentId]
    )
    return row?.data ?? null
  }

  async getLatest(documentId: string): Promise<Buffer | null> {
    const liveDoc = docs.get(documentId)
    if (liveDoc) {
      return Buffer.from(Y.encodeStateAsUpdate(liveDoc))
    }
    return this.getPersisted(documentId)
  }

  async set(documentId: string, data: Buffer): Promise<void> {
    this.connection.run(
      `INSERT INTO yjs_documents (name, data) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET data = excluded.data`,
      [documentId, data]
    )
  }

  async delete(documentId: string): Promise<void> {
    this.connection.run('DELETE FROM yjs_documents WHERE name = ?', [documentId])
  }
}
