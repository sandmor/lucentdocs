export function getMessageParts(message: unknown): unknown[] {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return []
  }

  const record = message as Record<string, unknown>
  return Array.isArray(record.parts) ? record.parts : []
}

export function extractMessageTextFromParts(parts: unknown[]): string {
  return extractMessageTextFromPartsRaw(parts).trim()
}

export function extractMessageTextFromPartsRaw(parts: unknown[]): string {
  return parts
    .flatMap((part) => {
      if (typeof part !== 'object' || part === null || Array.isArray(part)) return []
      const record = part as Record<string, unknown>
      if (record.type !== 'text') return []
      return typeof record.text === 'string' ? [record.text] : []
    })
    .join('')
}

export function extractToolPartsFromParts(parts: unknown[]): Record<string, unknown>[] {
  return parts.flatMap((part) => {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) return []
    const record = part as Record<string, unknown>
    if (typeof record.type !== 'string') return []
    if (record.type === 'dynamic-tool' || record.type.startsWith('tool-')) return [record]
    return []
  })
}
