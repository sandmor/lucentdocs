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

export interface InlineTurnCheckpoint {
  assistantMessageId: string
  zoneTextBefore: string
  zoneTextAfter: string
  assistantMessage: InlineChatMessage
}

function normalizeTurnCheckpoint(value: unknown): InlineTurnCheckpoint | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const assistantMessageId =
    typeof record.assistantMessageId === 'string' ? record.assistantMessageId.trim() : ''
  const zoneTextBefore = typeof record.zoneTextBefore === 'string' ? record.zoneTextBefore : ''
  const zoneTextAfter = typeof record.zoneTextAfter === 'string' ? record.zoneTextAfter : ''
  const assistantMessage = normalizeMessage(record.assistantMessage)

  if (!assistantMessageId || !assistantMessage || assistantMessage.role !== 'assistant') {
    return null
  }

  return {
    assistantMessageId,
    zoneTextBefore,
    zoneTextAfter,
    assistantMessage,
  }
}

export interface InlineZoneSession {
  messages: InlineChatMessage[]
  choices: string[]
  contextBefore: string | null
  contextAfter: string | null
  contextTruncated: boolean
  lastRequesterClientName?: string
  turnCheckpoints?: InlineTurnCheckpoint[]
  redoTurnCheckpoints?: InlineTurnCheckpoint[]
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

export function canUndoSessionTurn(session: InlineZoneSession | null | undefined): boolean {
  return (session?.turnCheckpoints?.length ?? 0) > 1
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
  const contextTruncated = record.contextTruncated === true
  const lastRequesterClientName =
    typeof record.lastRequesterClientName === 'string' && record.lastRequesterClientName.length > 0
      ? record.lastRequesterClientName
      : undefined
  const rawTurnCheckpoints = Array.isArray(record.turnCheckpoints) ? record.turnCheckpoints : []
  const rawRedoTurnCheckpoints = Array.isArray(record.redoTurnCheckpoints)
    ? record.redoTurnCheckpoints
    : []

  const session: InlineZoneSession = {
    messages: rawMessages.flatMap((entry) => {
      const normalized = normalizeMessage(entry)
      return normalized ? [normalized] : []
    }),
    choices: rawChoices.filter((entry): entry is string => typeof entry === 'string'),
    contextBefore,
    contextAfter,
    contextTruncated,
    ...(lastRequesterClientName ? { lastRequesterClientName } : {}),
  }

  const turnCheckpoints = rawTurnCheckpoints.flatMap((entry) => {
    const normalized = normalizeTurnCheckpoint(entry)
    return normalized ? [normalized] : []
  })
  if (turnCheckpoints.length > 0) {
    session.turnCheckpoints = turnCheckpoints
  }

  const redoTurnCheckpoints = rawRedoTurnCheckpoints.flatMap((entry) => {
    const normalized = normalizeTurnCheckpoint(entry)
    return normalized ? [normalized] : []
  })
  if (redoTurnCheckpoints.length > 0) {
    session.redoTurnCheckpoints = redoTurnCheckpoints
  }

  return session
}

export function normalizeInlineZoneSessionMap(value: unknown): Record<string, InlineZoneSession> {
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
