export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildHighlightPattern(query: string): RegExp | null {
  const terms = Array.from(
    new Set(
      query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
    )
  )
  if (terms.length === 0) return null
  return new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
}
