import type { NativeStorageEngine } from '@lucentdocs/core'
import type {
  ChatsRepositoryPort,
  ChatThreadRow,
  UpdateChatThreadData,
} from '../../core/ports/chats.port.js'
import { currentTxId } from './tx-scope.js'
import { chatThreadFromDto, chatThreadToDto, updateChatThreadToDto } from './mappers.js'

export class ChatsRepository implements ChatsRepositoryPort {
  constructor(private engine: NativeStorageEngine) {}

  async findById(
    projectId: string,
    documentId: string,
    id: string
  ): Promise<ChatThreadRow | undefined> {
    const row = await this.engine.chatsFindById(currentTxId(), projectId, documentId, id)
    return row ? chatThreadFromDto(row) : undefined
  }

  async listByDocument(projectId: string, documentId: string): Promise<ChatThreadRow[]> {
    const rows = await this.engine.chatsListByDocument(currentTxId(), projectId, documentId)
    return rows.map(chatThreadFromDto)
  }

  async listByProject(projectId: string): Promise<ChatThreadRow[]> {
    const rows = await this.engine.chatsListByProject(currentTxId(), projectId)
    return rows.map(chatThreadFromDto)
  }

  async insert(row: ChatThreadRow): Promise<void> {
    await this.engine.chatsInsert(currentTxId(), chatThreadToDto(row))
  }

  async update(
    projectId: string,
    documentId: string,
    id: string,
    data: UpdateChatThreadData
  ): Promise<boolean> {
    return this.engine.chatsUpdate(
      currentTxId(),
      projectId,
      documentId,
      id,
      updateChatThreadToDto(data)
    )
  }

  async deleteById(projectId: string, documentId: string, id: string): Promise<boolean> {
    return this.engine.chatsDeleteById(currentTxId(), projectId, documentId, id)
  }
}
