export interface ChatThreadSettings {
  editingEnabled: boolean
}

export const DEFAULT_CHAT_THREAD_SETTINGS: ChatThreadSettings = {
  editingEnabled: false,
}

export interface ChatThreadPayloadV1 {
  v: 1
  settings: ChatThreadSettings
  messages: unknown[]
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

export function isChatThreadPayloadV1(value: unknown): value is ChatThreadPayloadV1 {
  if (!isRecord(value)) return false
  if (value.v !== 1) return false
  if (!Array.isArray(value.messages)) return false
  if (!isChatThreadSettings(value.settings)) return false
  return true
}

export function createEmptyChatThreadPayload(): ChatThreadPayloadV1 {
  return {
    v: 1,
    settings: { ...DEFAULT_CHAT_THREAD_SETTINGS },
    messages: [],
  }
}

export function parseThreadPayload(raw: string): ChatThreadPayloadV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new ChatThreadPayloadError('Chat thread payload is not valid JSON.')
  }

  if (!isChatThreadPayloadV1(parsed)) {
    throw new ChatThreadPayloadError(
      'Chat thread payload must be a v1 envelope with settings and messages.'
    )
  }

  return parsed
}

export function serializeThreadPayload(payload: ChatThreadPayloadV1): string {
  return JSON.stringify(payload)
}
