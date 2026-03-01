export function createZoneId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `zone-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createInlineMessageId(role: 'user' | 'assistant'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `inline-${role}-${crypto.randomUUID()}`
  }

  return `inline-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createInlineSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `inline-session-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
