export interface InlineToolChip {
  toolName: string
  state: 'pending' | 'complete'
}

export interface InlineChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: InlineToolChip[]
}

export interface InlineZoneSession {
  messages: InlineChatMessage[]
  choices: string[]
  contextBefore: string | null
  contextAfter: string | null
}

function normalizeToolChip(value: unknown): InlineToolChip | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const toolName = typeof record.toolName === 'string' ? record.toolName.trim() : ''
  if (!toolName) return null

  const state = record.state === 'pending' || record.state === 'complete' ? record.state : null
  if (!state) return null

  return {
    toolName,
    state,
  }
}

function normalizeMessage(value: unknown): InlineChatMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const role = record.role === 'user' || record.role === 'assistant' ? record.role : null
  const text = typeof record.text === 'string' ? record.text : ''
  const rawTools = Array.isArray(record.tools) ? record.tools : []

  if (!id || !role) return null

  return {
    id,
    role,
    text,
    tools: rawTools.flatMap((entry) => {
      const normalized = normalizeToolChip(entry)
      return normalized ? [normalized] : []
    }),
  }
}

export function normalizeInlineZoneSession(value: unknown): InlineZoneSession | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const rawMessages = Array.isArray(record.messages) ? record.messages : []
  const rawChoices = Array.isArray(record.choices) ? record.choices : []

  const contextBefore =
    typeof record.contextBefore === 'string' && record.contextBefore.length > 0
      ? record.contextBefore
      : null
  const contextAfter =
    typeof record.contextAfter === 'string' && record.contextAfter.length > 0
      ? record.contextAfter
      : null

  return {
    messages: rawMessages.flatMap((entry) => {
      const normalized = normalizeMessage(entry)
      return normalized ? [normalized] : []
    }),
    choices: rawChoices.filter((entry): entry is string => typeof entry === 'string'),
    contextBefore,
    contextAfter,
  }
}

export function normalizeInlineZoneSessionMap(
  value: unknown
): Record<string, InlineZoneSession> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  const record = value as Record<string, unknown>
  const normalized: Record<string, InlineZoneSession> = {}

  for (const [sessionId, sessionValue] of Object.entries(record)) {
    if (!sessionId) continue
    const session = normalizeInlineZoneSession(sessionValue)
    if (!session) continue
    normalized[sessionId] = session
  }

  return normalized
}
