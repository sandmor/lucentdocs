export const DEFAULT_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

export function parseContent(content: string | null | undefined): Record<string, unknown> {
  if (!content) return DEFAULT_DOC
  try {
    return JSON.parse(content)
  } catch {
    console.error('Failed to parse document content')
    return DEFAULT_DOC
  }
}
