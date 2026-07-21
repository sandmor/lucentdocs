import { nanoid } from 'nanoid'
import { isValidId } from '@lucentdocs/shared'
import type { RepositorySet } from '../../core/ports/types.js'
import type { ChatThreadRow } from '../../core/ports/chats.port.js'
import {
  createEmptyChatThreadPayload,
  parseThreadPayload,
  serializeThreadPayload,
  type ChatThreadPayload,
  type ChatThreadSettings,
} from './chat-thread-payload.js'
import {
  deleteNode,
  forkRegeneration,
  pathToUIMessages,
  replaceNodeText,
  resolveActivePath,
  selectBranch,
  setAssistantOnActiveLeaf,
  summarizeTitleFromPayload,
  toTreeSnapshot,
  type ChatTreeSnapshot,
  type DeleteChatMessageMode,
} from '../../chat/tree.js'
import { normalizeMessages } from '../../chat/utils.js'

export type { ChatThreadSettings } from './chat-thread-payload.js'
export type { DeleteChatMessageMode } from '../../chat/tree.js'

export interface ChatThread {
  id: string
  projectId: string
  documentId: string
  title: string
  messages: unknown[]
  tree: ChatTreeSnapshot
  settings: ChatThreadSettings
  createdAt: number
  updatedAt: number
}

export interface ChatThreadSummary {
  id: string
  documentId: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface ChatsService {
  listForProject(projectId: string): Promise<ChatThreadSummary[]>
  listForDocument(projectId: string, documentId: string): Promise<ChatThreadSummary[]>
  getById(projectId: string, documentId: string, chatId: string): Promise<ChatThread | null>
  create(projectId: string, documentId: string, title?: string, editingEnabled?: boolean): Promise<ChatThread | null>
  savePayload(
    projectId: string,
    documentId: string,
    chatId: string,
    payload: ChatThreadPayload
  ): Promise<ChatThread | null>
  updateMessageById(
    projectId: string,
    documentId: string,
    chatId: string,
    messageId: string,
    text: string
  ): Promise<ChatThread | null>
  deleteMessagesById(
    projectId: string,
    documentId: string,
    chatId: string,
    messageId: string,
    mode: DeleteChatMessageMode
  ): Promise<ChatThread | null>
  selectBranchById(
    projectId: string,
    documentId: string,
    chatId: string,
    nodeId: string
  ): Promise<ChatThread | null>
  forkRegenerationById(
    projectId: string,
    documentId: string,
    chatId: string,
    messageId: string,
    text?: string
  ): Promise<{ thread: ChatThread; forkNodeId: string } | null>
  attachAssistantToActiveLeaf(
    projectId: string,
    documentId: string,
    chatId: string,
    assistantId: string,
    parts: unknown[]
  ): Promise<ChatThread | null>
  updateSettings(
    projectId: string,
    documentId: string,
    chatId: string,
    settings: Partial<ChatThreadSettings>
  ): Promise<ChatThread | null>
  rename(
    projectId: string,
    documentId: string,
    chatId: string,
    title: string
  ): Promise<ChatThread | null>
  delete(projectId: string, documentId: string, chatId: string): Promise<boolean>
}

function mergeSettings(
  current: ChatThreadSettings,
  patch: Partial<ChatThreadSettings>
): ChatThreadSettings {
  return {
    editingEnabled:
      typeof patch.editingEnabled === 'boolean' ? patch.editingEnabled : current.editingEnabled,
  }
}

async function payloadToThread(
  row: ChatThreadRow,
  payload: ChatThreadPayload
): Promise<ChatThread> {
  const path = resolveActivePath(payload)
  const messages = pathToUIMessages(path)
  await normalizeMessages(messages)

  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    title: row.title,
    messages,
    tree: toTreeSnapshot(payload),
    settings: payload.settings,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toSummary(thread: ChatThread): ChatThreadSummary {
  return {
    id: thread.id,
    documentId: thread.documentId,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length,
  }
}

async function loadPayload(
  repos: RepositorySet,
  projectId: string,
  documentId: string,
  chatId: string
): Promise<{ row: ChatThreadRow; payload: ChatThreadPayload } | null> {
  const row = await repos.chats.findById(projectId, documentId, chatId)
  if (!row) return null
  return { row, payload: parseThreadPayload(row.messages) }
}

export function createChatsService(repos: RepositorySet): ChatsService {
  return {
    async listForProject(projectId: string): Promise<ChatThreadSummary[]> {
      if (!isValidId(projectId)) return []
      const rows = await repos.chats.listByProject(projectId)
      const summaries: ChatThreadSummary[] = []
      for (const row of rows) {
        try {
          summaries.push(toSummary(await payloadToThread(row, parseThreadPayload(row.messages))))
        } catch {
          // Ignore corrupt payloads in project history.
        }
      }
      return summaries
    },

    async listForDocument(projectId: string, documentId: string): Promise<ChatThreadSummary[]> {
      if (!isValidId(projectId) || !isValidId(documentId)) return []
      const rows = await repos.chats.listByDocument(projectId, documentId)
      const summaries: ChatThreadSummary[] = []
      for (const row of rows) {
        try {
          const payload = parseThreadPayload(row.messages)
          const thread = await payloadToThread(row, payload)
          summaries.push(toSummary(thread))
        } catch {
          // Drop legacy or corrupt threads from listings.
        }
      }
      return summaries
    },

    async getById(
      projectId: string,
      documentId: string,
      chatId: string
    ): Promise<ChatThread | null> {
      if (!isValidId(projectId) || !isValidId(documentId) || !isValidId(chatId)) return null
      const loaded = await loadPayload(repos, projectId, documentId, chatId)
      return loaded ? payloadToThread(loaded.row, loaded.payload) : null
    },

    async create(
      projectId: string,
      documentId: string,
      title = 'New chat',
      editingEnabled
    ): Promise<ChatThread | null> {
      if (!isValidId(projectId) || !isValidId(documentId)) return null

      const now = Date.now()
      const id = nanoid()
      const normalizedTitle = title.trim() || 'New chat'
      const payload = createEmptyChatThreadPayload()
      if (typeof editingEnabled === 'boolean') payload.settings.editingEnabled = editingEnabled
      await repos.chats.insert({
        id,
        projectId,
        documentId,
        title: normalizedTitle,
        messages: serializeThreadPayload(payload),
        createdAt: now,
        updatedAt: now,
      })

      return {
        id,
        projectId,
        documentId,
        title: normalizedTitle,
        messages: [],
        tree: toTreeSnapshot(payload),
        settings: payload.settings,
        createdAt: now,
        updatedAt: now,
      }
    },

    async savePayload(
      projectId: string,
      documentId: string,
      chatId: string,
      payload: ChatThreadPayload
    ): Promise<ChatThread | null> {
      if (!isValidId(projectId) || !isValidId(documentId) || !isValidId(chatId)) return null
      const existing = await repos.chats.findById(projectId, documentId, chatId)
      if (!existing) return null

      const path = resolveActivePath(payload)
      await normalizeMessages(pathToUIMessages(path))

      const updatedAt = Date.now()
      const nextTitle =
        existing.title === 'New chat' ? summarizeTitleFromPayload(payload) : existing.title
      const saved = await repos.chats.update(projectId, documentId, chatId, {
        title: nextTitle,
        messages: serializeThreadPayload(payload),
        updatedAt,
      })
      if (!saved) return null

      return payloadToThread(
        {
          ...existing,
          title: nextTitle,
          messages: serializeThreadPayload(payload),
          updatedAt,
        },
        payload
      )
    },

    async updateMessageById(
      projectId: string,
      documentId: string,
      chatId: string,
      messageId: string,
      text: string
    ): Promise<ChatThread | null> {
      const loaded = await loadPayload(repos, projectId, documentId, chatId)
      if (!loaded) return null
      const nextPayload = replaceNodeText(loaded.payload, messageId, text)
      return this.savePayload(projectId, documentId, chatId, nextPayload)
    },

    async deleteMessagesById(
      projectId: string,
      documentId: string,
      chatId: string,
      messageId: string,
      mode: DeleteChatMessageMode
    ): Promise<ChatThread | null> {
      const loaded = await loadPayload(repos, projectId, documentId, chatId)
      if (!loaded) return null
      const nextPayload = deleteNode(loaded.payload, messageId, mode)
      return this.savePayload(projectId, documentId, chatId, nextPayload)
    },

    async selectBranchById(
      projectId: string,
      documentId: string,
      chatId: string,
      nodeId: string
    ): Promise<ChatThread | null> {
      const loaded = await loadPayload(repos, projectId, documentId, chatId)
      if (!loaded) return null
      const nextPayload = selectBranch(loaded.payload, nodeId)
      return this.savePayload(projectId, documentId, chatId, nextPayload)
    },

    async forkRegenerationById(
      projectId: string,
      documentId: string,
      chatId: string,
      messageId: string,
      text?: string
    ): Promise<{ thread: ChatThread; forkNodeId: string } | null> {
      const loaded = await loadPayload(repos, projectId, documentId, chatId)
      if (!loaded) return null
      const { payload: nextPayload, forkNodeId } = forkRegeneration(loaded.payload, messageId, {
        text,
      })
      const thread = await this.savePayload(projectId, documentId, chatId, nextPayload)
      if (!thread) return null
      return { thread, forkNodeId }
    },

    async attachAssistantToActiveLeaf(
      projectId: string,
      documentId: string,
      chatId: string,
      assistantId: string,
      parts: unknown[]
    ): Promise<ChatThread | null> {
      const loaded = await loadPayload(repos, projectId, documentId, chatId)
      if (!loaded) return null
      const nextPayload = setAssistantOnActiveLeaf(loaded.payload, assistantId, parts)
      return this.savePayload(projectId, documentId, chatId, nextPayload)
    },

    async updateSettings(
      projectId: string,
      documentId: string,
      chatId: string,
      settings: Partial<ChatThreadSettings>
    ): Promise<ChatThread | null> {
      if (!isValidId(projectId) || !isValidId(documentId) || !isValidId(chatId)) return null
      const loaded = await loadPayload(repos, projectId, documentId, chatId)
      if (!loaded) return null

      const nextPayload: ChatThreadPayload = {
        ...loaded.payload,
        settings: mergeSettings(loaded.payload.settings, settings),
      }

      const updatedAt = Date.now()
      const saved = await repos.chats.update(projectId, documentId, chatId, {
        messages: serializeThreadPayload(nextPayload),
        updatedAt,
      })
      if (!saved) return null

      return payloadToThread(
        {
          ...loaded.row,
          messages: serializeThreadPayload(nextPayload),
          updatedAt,
        },
        nextPayload
      )
    },

    async rename(projectId: string, documentId: string, chatId: string, title: string) {
      const loaded = await loadPayload(repos, projectId, documentId, chatId)
      if (!loaded) return null
      const nextTitle = title.trim()
      if (!nextTitle) return null
      const updatedAt = Date.now()
      const saved = await repos.chats.update(projectId, documentId, chatId, {
        title: nextTitle,
        updatedAt,
      })
      if (!saved) return null
      return payloadToThread({ ...loaded.row, title: nextTitle, updatedAt }, loaded.payload)
    },

    async delete(projectId: string, documentId: string, chatId: string): Promise<boolean> {
      if (!isValidId(projectId) || !isValidId(documentId) || !isValidId(chatId)) return false
      return repos.chats.deleteById(projectId, documentId, chatId)
    },
  }
}
