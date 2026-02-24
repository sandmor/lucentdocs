import type {
  ChatsRepositoryPort,
  ChatThreadRow,
  UpdateChatThreadData,
} from '../../core/ports/chats.port.js'
import type { SqliteConnection } from './connection.js'

export class ChatsRepository implements ChatsRepositoryPort {
  constructor(private connection: SqliteConnection) {}

  async findById(
    projectId: string,
    documentId: string,
    id: string
  ): Promise<ChatThreadRow | undefined> {
    return this.connection.get<ChatThreadRow>(
      `SELECT id, projectId, documentId, title, messages, createdAt, updatedAt
       FROM chat_threads
       WHERE projectId = ? AND documentId = ? AND id = ?`,
      [projectId, documentId, id]
    )
  }

  async listByDocument(projectId: string, documentId: string): Promise<ChatThreadRow[]> {
    return this.connection.all<ChatThreadRow>(
      `SELECT id, projectId, documentId, title, messages, createdAt, updatedAt
       FROM chat_threads
       WHERE projectId = ? AND documentId = ?
       ORDER BY updatedAt DESC, createdAt DESC`,
      [projectId, documentId]
    )
  }

  async insert(row: ChatThreadRow): Promise<void> {
    this.connection.run(
      'INSERT INTO chat_threads (id, projectId, documentId, title, messages, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [row.id, row.projectId, row.documentId, row.title, row.messages, row.createdAt, row.updatedAt]
    )
  }

  async update(
    projectId: string,
    documentId: string,
    id: string,
    data: UpdateChatThreadData
  ): Promise<boolean> {
    const clauses: string[] = []
    const params: unknown[] = []

    if (data.title !== undefined) {
      clauses.push('title = ?')
      params.push(data.title)
    }
    if (data.messages !== undefined) {
      clauses.push('messages = ?')
      params.push(data.messages)
    }

    clauses.push('updatedAt = ?')
    params.push(data.updatedAt)
    params.push(projectId, documentId, id)

    const result = this.connection.run(
      `UPDATE chat_threads SET ${clauses.join(', ')} WHERE projectId = ? AND documentId = ? AND id = ?`,
      params
    )
    return result.changes > 0
  }

  async deleteById(projectId: string, documentId: string, id: string): Promise<boolean> {
    const result = this.connection.run(
      'DELETE FROM chat_threads WHERE projectId = ? AND documentId = ? AND id = ?',
      [projectId, documentId, id]
    )
    return result.changes > 0
  }
}
