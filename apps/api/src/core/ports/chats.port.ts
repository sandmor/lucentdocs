export interface ChatThreadRow {
  id: string
  projectId: string
  documentId: string
  title: string
  messages: string
  createdAt: number
  updatedAt: number
}

export interface UpdateChatThreadData {
  title?: string
  messages?: string
  updatedAt: number
}

export interface ChatsRepositoryPort {
  findById(projectId: string, documentId: string, id: string): Promise<ChatThreadRow | undefined>
  listByDocument(projectId: string, documentId: string): Promise<ChatThreadRow[]>
  insert(row: ChatThreadRow): Promise<void>
  update(
    projectId: string,
    documentId: string,
    id: string,
    data: UpdateChatThreadData
  ): Promise<boolean>
  deleteById(projectId: string, documentId: string, id: string): Promise<boolean>
}
