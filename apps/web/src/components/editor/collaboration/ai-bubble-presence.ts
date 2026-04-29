import type { CollaborationAwareness } from '../prosemirror/presence'

export const AI_BUBBLES_STATE_FIELD = 'aiBubbles'

export interface AIBubblePresenceFrame {
  sessionId: string
  zoneId: string
  generationId: string
  ownerClientId: number
  seq: number
  text: string
  updatedAt: number
}

export type AIBubblePresencePublishInput = Omit<AIBubblePresenceFrame, 'ownerClientId'> & {
  ownerClientId?: number
}

type AIBubblePresenceMap = Record<string, AIBubblePresenceFrame>
type AIBubblePresenceListener = () => void

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeBubblePresenceFrame(
  value: unknown,
  fallbackOwnerClientId: number
): AIBubblePresenceFrame | null {
  const record = asRecord(value)
  if (!record) return null

  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
  const zoneId = typeof record.zoneId === 'string' ? record.zoneId.trim() : ''
  const generationId = typeof record.generationId === 'string' ? record.generationId.trim() : ''
  if (!sessionId || !zoneId || !generationId) return null

  const ownerClientId =
    typeof record.ownerClientId === 'number' && Number.isFinite(record.ownerClientId)
      ? record.ownerClientId
      : fallbackOwnerClientId
  const seq = typeof record.seq === 'number' && Number.isFinite(record.seq) ? record.seq : 0
  const text = typeof record.text === 'string' ? record.text : ''
  const updatedAt =
    typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0

  return {
    sessionId,
    zoneId,
    generationId,
    ownerClientId,
    seq,
    text,
    updatedAt,
  }
}

function normalizeBubblePresenceMap(
  value: unknown,
  fallbackOwnerClientId: number
): AIBubblePresenceMap {
  const record = asRecord(value)
  if (!record) return {}

  const normalized: AIBubblePresenceMap = {}
  for (const [sessionId, entry] of Object.entries(record)) {
    if (!sessionId) continue
    const frame = normalizeBubblePresenceFrame(entry, fallbackOwnerClientId)
    if (!frame) continue
    normalized[sessionId] = frame
  }

  return normalized
}

function compareFrames(left: AIBubblePresenceFrame, right: AIBubblePresenceFrame): number {
  if (left.seq !== right.seq) {
    return left.seq - right.seq
  }
  if (left.generationId !== right.generationId) {
    return left.generationId.localeCompare(right.generationId)
  }
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt - right.updatedAt
  }
  if (left.ownerClientId !== right.ownerClientId) {
    return left.ownerClientId - right.ownerClientId
  }
  return 0
}

export class AIBubblePresenceStore {
  #awareness: CollaborationAwareness
  #listeners = new Set<AIBubblePresenceListener>()
  #handleChange = () => {
    for (const listener of this.#listeners) {
      listener()
    }
  }

  constructor(awareness: CollaborationAwareness) {
    this.#awareness = awareness
    this.#awareness.on('change', this.#handleChange)
  }

  destroy(): void {
    this.clearAll()
    this.#awareness.off('change', this.#handleChange)
    this.#listeners.clear()
  }

  subscribe(listener: AIBubblePresenceListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  publish(frame: AIBubblePresencePublishInput): void {
    const localState = asRecord(this.#awareness.getLocalState())
    const current = normalizeBubblePresenceMap(
      localState?.[AI_BUBBLES_STATE_FIELD],
      this.#awareness.clientID
    )

    this.#awareness.setLocalStateField(AI_BUBBLES_STATE_FIELD, {
      ...current,
      [frame.sessionId]: {
        ...frame,
        ownerClientId: frame.ownerClientId ?? this.#awareness.clientID,
      },
    })
  }

  clear(sessionId: string): void {
    const trimmedSessionId = sessionId.trim()
    if (!trimmedSessionId) return

    const localState = asRecord(this.#awareness.getLocalState())
    const current = normalizeBubblePresenceMap(
      localState?.[AI_BUBBLES_STATE_FIELD],
      this.#awareness.clientID
    )
    if (!(trimmedSessionId in current)) return

    const next = { ...current }
    delete next[trimmedSessionId]
    this.#awareness.setLocalStateField(
      AI_BUBBLES_STATE_FIELD,
      Object.keys(next).length > 0 ? next : null
    )
  }

  clearAll(): void {
    this.#awareness.setLocalStateField(AI_BUBBLES_STATE_FIELD, null)
  }

  getFrame(zoneId: string, sessionId?: string | null): AIBubblePresenceFrame | null {
    const trimmedZoneId = zoneId.trim()
    if (!trimmedZoneId) return null

    let latest: AIBubblePresenceFrame | null = null
    this.#awareness.getStates().forEach((rawState, clientId) => {
      const record = asRecord(rawState)
      const frames = normalizeBubblePresenceMap(record?.[AI_BUBBLES_STATE_FIELD], clientId)
      for (const frame of Object.values(frames)) {
        if (frame.zoneId !== trimmedZoneId) continue
        if (sessionId && frame.sessionId !== sessionId) continue
        if (!latest || compareFrames(latest, frame) < 0) {
          latest = frame
        }
      }
    })

    return latest
  }
}
