const PRESENCE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#65a30d',
  '#4f46e5',
  '#c2410c',
] as const

export const DEFAULT_CURSOR_STATE_FIELD = 'cursor'

export interface CollaborationPresenceUser {
  name: string
  color: string
}

export interface CollaborationPresenceCursor {
  anchor: unknown
  head: unknown
}

export interface CollaborationAwareness {
  clientID: number
  getLocalState: () => unknown
  getStates: () => Map<number, unknown>
  on: (eventName: 'change', listener: () => void) => void
  off: (eventName: 'change', listener: () => void) => void
  setLocalStateField: (field: string, value: unknown) => void
}

interface AwarenessLike {
  setLocalStateField: (field: string, value: unknown) => void
}

export function getLocalPresenceUser(clientId: number): CollaborationPresenceUser {
  const paletteIndex = Math.abs(clientId) % PRESENCE_COLORS.length

  return {
    name: `User ${clientId}`,
    color: PRESENCE_COLORS[paletteIndex],
  }
}

export function installLocalPresenceUser(
  awareness: AwarenessLike,
  user: CollaborationPresenceUser
): void {
  awareness.setLocalStateField('user', user)
}

export function normalizePresenceUser(value: unknown, clientId: number): CollaborationPresenceUser {
  const fallback = getLocalPresenceUser(clientId)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }

  const raw = value as Record<string, unknown>
  const name = typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name : fallback.name
  const color =
    typeof raw.color === 'string' && isPresenceColor(raw.color) ? raw.color : fallback.color

  return { name, color }
}

export function samePresenceRects(
  previous: Array<{ left: number; top: number; width: number; height: number }>,
  next: Array<{ left: number; top: number; width: number; height: number }>
): boolean {
  if (previous.length !== next.length) return false

  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index]
    const right = next[index]

    if (
      left.left !== right.left ||
      left.top !== right.top ||
      left.width !== right.width ||
      left.height !== right.height
    ) {
      return false
    }
  }

  return true
}

function isPresenceColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}
