import { nanoid } from 'nanoid'
import { isValidId } from '@plotline/shared'
import * as dalChatThreads from '../dal/chatThreads.js'

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

function toChatThread(row: dalChatThreads.ChatThreadRow): ChatThread {
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

export async function listDocumentChats(
  projectId: string,
  documentId: string
): Promise<ChatThreadSummary[]> {
  if (!isValidId(projectId) || !isValidId(documentId)) return []
  const rows = await dalChatThreads.listByDocument(projectId, documentId)
  return rows.map((row) => toSummary(toChatThread(row)))
}

export async function getDocumentChatById(
  projectId: string,
  documentId: string,
  chatId: string
): Promise<ChatThread | null> {
  if (!isValidId(projectId) || !isValidId(documentId) || !isValidId(chatId)) return null
  const row = await dalChatThreads.findById(projectId, documentId, chatId)
  return row ? toChatThread(row) : null
}

export async function createDocumentChat(
  projectId: string,
  documentId: string,
  title = 'New chat'
): Promise<ChatThread | null> {
  if (!isValidId(projectId) || !isValidId(documentId)) return null

  const now = Date.now()
  const id = nanoid()
  const normalizedTitle = title.trim() || 'New chat'
  await dalChatThreads.insert({
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
}

export async function saveDocumentChat(
  projectId: string,
  documentId: string,
  chatId: string,
  messages: unknown[]
): Promise<ChatThread | null> {
  if (!isValidId(projectId) || !isValidId(documentId) || !isValidId(chatId)) return null
  const existing = await dalChatThreads.findById(projectId, documentId, chatId)
  if (!existing) return null

  const updatedAt = Date.now()
  const nextTitle = existing.title === 'New chat' ? summarizeTitle(messages) : existing.title
  const updated = await dalChatThreads.update(projectId, documentId, chatId, {
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
}

export async function deleteDocumentChat(
  projectId: string,
  documentId: string,
  chatId: string
): Promise<boolean> {
  if (!isValidId(projectId) || !isValidId(documentId) || !isValidId(chatId)) return false
  return await dalChatThreads.deleteById(projectId, documentId, chatId)
}
