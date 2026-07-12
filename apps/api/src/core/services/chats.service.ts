import { nanoid } from 'nanoid'
import { isValidId } from '@lucentdocs/shared'
import type { RepositorySet } from '../../core/ports/types.js'
import type { ChatThreadRow } from '../../core/ports/chats.port.js'
import {
  createEmptyChatThreadPayload,
  parseThreadPayload,
  serializeThreadPayload,
  type ChatThreadPayloadV1,
  type ChatThreadSettings,
} from './chat-thread-payload.js'
import {
  deleteMessageAt,
  normalizeMessages,
  replaceMessageText,
  type DeleteChatMessageMode,
} from '../../chat/utils.js'

export type { ChatThreadSettings } from './chat-thread-payload.js'

export interface ChatThread {
  id: string
  projectId: string
  documentId: string
  title: string
  messages: unknown[]
  settings: ChatThreadSettings
  createdAt: number
  updatedAt: number
}

export interface ChatThreadSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface ChatsService {
  listForDocument(projectId: string, documentId: string): Promise<ChatThreadSummary[]>
  getById(projectId: string, documentId: string, chatId: string): Promise<ChatThread | null>
  create(projectId: string, documentId: string, title?: string): Promise<ChatThread | null>
  save(
    projectId: string,
    documentId: string,
    chatId: string,
    messages: unknown[]
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
  updateSettings(
    projectId: string,
    documentId: string,
    chatId: string,
    settings: Partial<ChatThreadSettings>
  ): Promise<ChatThread | null>
  delete(projectId: string, documentId: string, chatId: string): Promise<boolean>
}

function countMessages(messages: unknown[]): number {
  return messages.length
}

function summarizeTitle(messages: unknown[]): string {
  for (const message of messages) {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) continue
    const record = message as Record<string, unknown>
    if (record.role !== 'user') continue
    if (!Array.isArray(record.parts)) continue

    const text = record.parts
      .flatMap((part) => {
        if (typeof part !== 'object' || part === null || Array.isArray(part)) return []
        const partRecord = part as Record<string, unknown>
        if (partRecord.type !== 'text') return []
        return typeof partRecord.text === 'string' ? [partRecord.text] : []
      })
      .join('')
      .trim()

    if (!text) continue
    return text.length > 80 ? `${text.slice(0, 80)}...` : text
  }

  return 'New chat'
}

function toChatThread(row: ChatThreadRow): ChatThread {
  const payload = parseThreadPayload(row.messages)
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    title: row.title,
    messages: payload.messages,
    settings: payload.settings,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toSummary(thread: ChatThread): ChatThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: countMessages(thread.messages),
  }
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

export function createChatsService(repos: RepositorySet): ChatsService {
  return {
    async listForDocument(projectId: string, documentId: string): Promise<ChatThreadSummary[]> {
      if (!isValidId(projectId) || !isValidId(documentId)) return []
      const rows = await repos.chats.listByDocument(projectId, documentId)
      return rows.map((row: ChatThreadRow) => toSummary(toChatThread(row)))
    },

    async getById(
      projectId: string,
      documentId: string,
      chatId: string
    ): Promise<ChatThread | null> {
      if (!isValidId(projectId) || !isValidId(documentId) || !isValidId(chatId)) return null
      const row = await repos.chats.findById(projectId, documentId, chatId)
      return row ? toChatThread(row) : null
    },

    async create(
      projectId: string,
      documentId: string,
      title = 'New chat'
    ): Promise<ChatThread | null> {
      if (!isValidId(projectId) || !isValidId(documentId)) return null

      const now = Date.now()
      const id = nanoid()
      const normalizedTitle = title.trim() || 'New chat'
      const payload = createEmptyChatThreadPayload()
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
        messages: payload.messages,
        settings: payload.settings,
        createdAt: now,
        updatedAt: now,
      }
    },

    async save(
      projectId: string,
      documentId: string,
      chatId: string,
      messages: unknown[]
    ): Promise<ChatThread | null> {
      if (!isValidId(projectId) || !isValidId(documentId) || !isValidId(chatId)) return null
      const existing = await repos.chats.findById(projectId, documentId, chatId)
      if (!existing) return null

      const currentPayload = parseThreadPayload(existing.messages)
      const nextPayload: ChatThreadPayloadV1 = {
        v: 1,
        settings: currentPayload.settings,
        messages,
      }

      const updatedAt = Date.now()
      const nextTitle =
        existing.title === 'New chat' ? summarizeTitle(messages) : existing.title
      const updated = await repos.chats.update(projectId, documentId, chatId, {
        title: nextTitle,
        messages: serializeThreadPayload(nextPayload),
        updatedAt,
      })
      if (!updated) return null

      return {
        id: existing.id,
        projectId: existing.projectId,
        documentId: existing.documentId,
        title: nextTitle,
        messages,
        settings: nextPayload.settings,
        createdAt: existing.createdAt,
        updatedAt,
      }
    },

    async updateMessageById(
      projectId: string,
      documentId: string,
      chatId: string,
      messageId: string,
      text: string
    ): Promise<ChatThread | null> {
      const thread = await this.getById(projectId, documentId, chatId)
      if (!thread) return null
      const messages = await normalizeMessages(thread.messages)
      const updatedMessages = replaceMessageText(messages, messageId, text)
      await normalizeMessages(updatedMessages)
      return this.save(projectId, documentId, chatId, updatedMessages)
    },

    async deleteMessagesById(
      projectId: string,
      documentId: string,
      chatId: string,
      messageId: string,
      mode: DeleteChatMessageMode
    ): Promise<ChatThread | null> {
      const thread = await this.getById(projectId, documentId, chatId)
      if (!thread) return null
      const messages = await normalizeMessages(thread.messages)
      const updatedMessages = deleteMessageAt(messages, messageId, mode)
      await normalizeMessages(updatedMessages)
      return this.save(projectId, documentId, chatId, updatedMessages)
    },

    async updateSettings(
      projectId: string,
      documentId: string,
      chatId: string,
      settings: Partial<ChatThreadSettings>
    ): Promise<ChatThread | null> {
      if (!isValidId(projectId) || !isValidId(documentId) || !isValidId(chatId)) return null
      const existing = await repos.chats.findById(projectId, documentId, chatId)
      if (!existing) return null

      const currentPayload = parseThreadPayload(existing.messages)
      const nextPayload: ChatThreadPayloadV1 = {
        v: 1,
        settings: mergeSettings(currentPayload.settings, settings),
        messages: currentPayload.messages,
      }

      const updatedAt = Date.now()
      const updated = await repos.chats.update(projectId, documentId, chatId, {
        messages: serializeThreadPayload(nextPayload),
        updatedAt,
      })
      if (!updated) return null

      return {
        id: existing.id,
        projectId: existing.projectId,
        documentId: existing.documentId,
        title: existing.title,
        messages: nextPayload.messages,
        settings: nextPayload.settings,
        createdAt: existing.createdAt,
        updatedAt,
      }
    },

    async delete(projectId: string, documentId: string, chatId: string): Promise<boolean> {
      if (!isValidId(projectId) || !isValidId(documentId) || !isValidId(chatId)) return false
      return repos.chats.deleteById(projectId, documentId, chatId)
    },
  }
}
