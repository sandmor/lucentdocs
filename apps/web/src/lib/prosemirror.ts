export const DEFAULT_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

export interface PersistedAIDraft {
  from: number
  to: number
}

export interface PersistedEditorContent {
  doc: Record<string, unknown>
  aiDraft: PersistedAIDraft | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPersistedAIDraft(value: unknown): value is PersistedAIDraft {
  if (!isRecord(value)) return false

  const from = value.from
  const to = value.to

  if (typeof from !== 'number' || typeof to !== 'number') return false
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false
  return from >= 0 && to > from
}

export function parseContent(content: string | null | undefined): PersistedEditorContent {
  if (!content) return { doc: DEFAULT_DOC, aiDraft: null }
  try {
    const parsed = JSON.parse(content) as unknown

    if (isRecord(parsed) && isRecord(parsed.doc)) {
      return {
        doc: parsed.doc,
        aiDraft: isPersistedAIDraft(parsed.aiDraft) ? parsed.aiDraft : null,
      }
    }

    if (isRecord(parsed) && parsed.type === 'doc') {
      return {
        doc: parsed,
        aiDraft: null,
      }
    }

    return { doc: DEFAULT_DOC, aiDraft: null }
  } catch {
    console.error('Failed to parse document content')
    return { doc: DEFAULT_DOC, aiDraft: null }
  }
}

export function serializeContent(content: PersistedEditorContent): string {
  return JSON.stringify(content)
}
