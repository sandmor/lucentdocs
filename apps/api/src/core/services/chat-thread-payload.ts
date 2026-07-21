export interface ChatThreadSettings {
  editingEnabled: boolean
}

export const DEFAULT_CHAT_THREAD_SETTINGS: ChatThreadSettings = {
  editingEnabled: true,
}

export interface ChatTreeNode {
  id: string
  role: 'user' | 'assistant'
  parts: unknown[]
  parentId: string | null
  childIds: string[]
  selectedChildId: string | null
}

export interface ChatThreadPayload {
  v: 1
  settings: ChatThreadSettings
  nodes: Record<string, ChatTreeNode>
  rootChildIds: string[]
  selectedRootChildId: string | null
}

export class ChatThreadPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatThreadPayloadError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isChatThreadSettings(value: unknown): value is ChatThreadSettings {
  if (!isRecord(value)) return false
  return typeof value.editingEnabled === 'boolean'
}

function isChatTreeNode(value: unknown): value is ChatTreeNode {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string') return false
  if (value.role !== 'user' && value.role !== 'assistant') return false
  if (!Array.isArray(value.parts)) return false
  if (value.parentId !== null && typeof value.parentId !== 'string') return false
  if (!Array.isArray(value.childIds)) return false
  if (value.selectedChildId !== null && typeof value.selectedChildId !== 'string') return false
  return true
}

export function isChatThreadPayload(value: unknown): value is ChatThreadPayload {
  if (!isRecord(value)) return false
  if (value.v !== 1) return false
  if (!isChatThreadSettings(value.settings)) return false
  if (!isRecord(value.nodes)) return false
  if (!Array.isArray(value.rootChildIds)) return false
  if (value.selectedRootChildId !== null && typeof value.selectedRootChildId !== 'string') {
    return false
  }

  for (const node of Object.values(value.nodes)) {
    if (!isChatTreeNode(node)) return false
  }

  return true
}

export function createEmptyChatThreadPayload(): ChatThreadPayload {
  return {
    v: 1,
    settings: { ...DEFAULT_CHAT_THREAD_SETTINGS },
    nodes: {},
    rootChildIds: [],
    selectedRootChildId: null,
  }
}

export function parseThreadPayload(raw: string): ChatThreadPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new ChatThreadPayloadError('Chat thread payload is not valid JSON.')
  }

  if (!isChatThreadPayload(parsed)) {
    throw new ChatThreadPayloadError(
      'Chat thread payload must be a v2 envelope with settings and tree nodes.'
    )
  }

  return parsed
}

export function serializeThreadPayload(payload: ChatThreadPayload): string {
  return JSON.stringify(payload)
}
