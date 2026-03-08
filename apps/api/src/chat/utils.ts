import {
  directoryPathFromSentinel,
  isDirectorySentinelPath,
  normalizeDocumentPath,
  parentDocumentPath,
  parseContent,
  pathSegments,
  schema,
} from '@lucentdocs/shared'
import { Node as ProseMirrorNode } from 'prosemirror-model'
import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown'
import { nanoid } from 'nanoid'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { configManager } from '../config/runtime.js'
import type { ChatThread } from '../core/services/chats.service.js'

const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    ai_zone(state, node) {
      state.renderContent(node)
    },
  },
  defaultMarkdownSerializer.marks
)

export interface ProjectFileIndex {
  files: Map<string, string>
  directories: Set<string>
}

export interface PersistedChatThread {
  id: string
  title: string
  messages: unknown[]
  createdAt: number
  updatedAt: number
}

export class ChatRuntimeError extends Error {
  readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT'

  constructor(code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT', message: string) {
    super(message)
    this.name = 'ChatRuntimeError'
    this.code = code
  }
}

export function toChatKey(scope: {
  projectId: string
  documentId: string
  chatId: string
}): string {
  return `${scope.projectId}:${scope.documentId}:${scope.chatId}`
}

export function toPersistedThread(thread: ChatThread | null): PersistedChatThread | null {
  if (!thread) return null

  return {
    id: thread.id,
    title: thread.title,
    messages: thread.messages,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  }
}

export function createObserveState(
  scope: { projectId: string; documentId: string; chatId: string },
  options: {
    thread: PersistedChatThread | null
    generating: boolean
    generationId: string | null
    error?: string | null
  }
) {
  return {
    projectId: scope.projectId,
    documentId: scope.documentId,
    chatId: scope.chatId,
    deleted: options.thread === null,
    generating: options.generating,
    generationId: options.generationId,
    error: options.error ?? null,
    thread: options.thread,
  }
}

export function buildThreadFromState(
  thread: PersistedChatThread,
  messages: UIMessage[],
  updatedAt: number
): PersistedChatThread {
  return {
    ...thread,
    messages,
    updatedAt,
  }
}

export function normalizeProjectPath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed || trimmed === '/' || trimmed === '.') return ''

  const normalized = normalizeDocumentPath(trimmed.replace(/^\/+/, ''))
  const hasInvalidSegments = pathSegments(normalized).some(
    (segment) => segment === '.' || segment === '..'
  )
  if (hasInvalidSegments) {
    throw new Error('Path contains unsupported segments.')
  }

  return normalized
}

function addDirectoryWithAncestors(pathValue: string, directories: Set<string>): void {
  directories.add('')

  const segments = pathSegments(pathValue)
  for (let index = 1; index <= segments.length; index += 1) {
    directories.add(segments.slice(0, index).join('/'))
  }
}

export async function buildProjectFileIndex(
  projectId: string,
  listDocumentsForProject: (projectId: string) => Promise<Array<{ id: string; title: string }>>
): Promise<ProjectFileIndex> {
  const documents = await listDocumentsForProject(projectId)
  const files = new Map<string, string>()
  const directories = new Set<string>([''])

  for (const document of documents) {
    const normalizedTitle = normalizeDocumentPath(document.title)
    if (!normalizedTitle) continue

    if (isDirectorySentinelPath(normalizedTitle)) {
      const directoryPath = directoryPathFromSentinel(normalizedTitle)
      if (directoryPath) addDirectoryWithAncestors(directoryPath, directories)
      continue
    }

    files.set(normalizedTitle, document.id)
    addDirectoryWithAncestors(parentDocumentPath(normalizedTitle), directories)
  }

  return { files, directories }
}

function parseDocumentNode(content: string): ProseMirrorNode | null {
  try {
    const parsed = parseContent(content)
    return ProseMirrorNode.fromJSON(schema, parsed.doc)
  } catch {
    return null
  }
}

/**
 * Renders the current document into the prompt format expected by chat prompts.
 * The selection range is clamped against the parsed ProseMirror document so stale
 * client offsets degrade to a caret marker instead of throwing.
 */
export function buildCurrentFileContext(
  content: string,
  selectionFrom: number | undefined,
  selectionTo: number | undefined
): string {
  const documentNode = parseDocumentNode(content)
  if (!documentNode) return '<caret />'

  const docEnd = documentNode.content.size
  const rawFrom = selectionFrom ?? docEnd
  const rawTo = selectionTo ?? rawFrom
  const clampedFrom = Math.max(0, Math.min(rawFrom, docEnd))
  const clampedTo = Math.max(0, Math.min(rawTo, docEnd))
  const from = Math.min(clampedFrom, clampedTo)
  const to = Math.max(clampedFrom, clampedTo)

  if (from < to) {
    const before = documentNode.textBetween(0, from, '\n\n', '\n')
    const selection = documentNode.textBetween(from, to, '\n\n', '\n')
    const after = documentNode.textBetween(to, docEnd, '\n\n', '\n')
    return `${before}<selection>${selection}</selection>${after}`
  }

  const before = documentNode.textBetween(0, from, '\n\n', '\n')
  const after = documentNode.textBetween(from, docEnd, '\n\n', '\n')
  return `${before}<caret />${after}`
}

export function projectDocumentToMarkdown(content: string): string {
  const documentNode = parseDocumentNode(content)
  if (!documentNode) return ''

  try {
    return markdownSerializer.serialize(documentNode).trimEnd()
  } catch {
    return documentNode.textBetween(0, documentNode.content.size, '\n\n', '\n').trimEnd()
  }
}

export function serializeConversationForPrompt(messages: UIMessage[]): string {
  const lines: string[] = []

  for (const message of messages) {
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const parts = Array.isArray(message.parts) ? message.parts : []
    const text = parts
      .flatMap((part) => {
        if (typeof part !== 'object' || part === null || Array.isArray(part)) return []
        const record = part as Record<string, unknown>
        if (record.type !== 'text') return []
        return typeof record.text === 'string' ? [record.text] : []
      })
      .join('')
      .trim()

    if (!text) continue
    lines.push(`${role}: ${text}`)
  }

  // Keep only the recent tail so prompts stay within token budget while still
  // preserving the latest conversational turns.
  return lines.slice(-24).join('\n')
}

export function createUserMessage(text: string): UIMessage {
  return {
    id: nanoid(),
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

export function readResponseError(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to generate chat response'
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export async function normalizeMessages(messages: unknown[]): Promise<UIMessage[]> {
  if (messages.length === 0) {
    return []
  }

  const validated = await safeValidateUIMessages<UIMessage>({ messages })
  if (!validated.success) {
    throw new ChatRuntimeError(
      'BAD_REQUEST',
      `Stored chat messages are invalid: ${validated.error.message}`
    )
  }
  return validated.data
}

export function toModelMessages(messages: UIMessage[]): Array<Omit<UIMessage, 'id'>> {
  return messages.map((message) => {
    const { id, ...withoutId } = message
    void id
    return withoutId
  })
}

export function getToolLimits() {
  const limits = configManager.getConfig().limits
  return {
    MAX_TOOL_ENTRIES: limits.toolEntries,
    MAX_TOOL_READ_CHARS: limits.toolReadChars,
  }
}
