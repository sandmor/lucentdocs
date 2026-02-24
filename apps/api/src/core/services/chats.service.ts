import { nanoid } from 'nanoid'
import { isValidId } from '@plotline/shared'
import type { RepositorySet } from '../../core/ports/types.js'
import type { ChatThreadRow } from '../../core/ports/chats.port.js'

export interface ChatThread {
  id: string
  projectId: string
  documentId: string
  title: string
  messages: unknown[]
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
  delete(projectId: string, documentId: string, chatId: string): Promise<boolean>
}

function parseMessages(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
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
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    title: row.title,
    messages: parseMessages(row.messages),
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
      await repos.chats.insert({
        id,
        projectId,
        documentId,
        title: normalizedTitle,
        messages: '[]',
        createdAt: now,
        updatedAt: now,
      })

      return {
        id,
        projectId,
        documentId,
        title: normalizedTitle,
        messages: [],
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

      const updatedAt = Date.now()
      const nextTitle = existing.title === 'New chat' ? summarizeTitle(messages) : existing.title
      const updated = await repos.chats.update(projectId, documentId, chatId, {
        title: nextTitle,
        messages: JSON.stringify(messages),
        updatedAt,
      })
      if (!updated) return null

      return {
        id: existing.id,
        projectId: existing.projectId,
        documentId: existing.documentId,
        title: nextTitle,
        messages,
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
