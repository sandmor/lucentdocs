import type { JsonObject } from './json.js'

const DEFAULT_DOC = { type: 'doc', content: [{ type: 'paragraph' }] } as const

interface PersistedAIDraft {
  from: number
  to: number
}

interface PersistedEditorContent {
  doc: JsonObject
  aiDraft: PersistedAIDraft | null
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    return { doc: DEFAULT_DOC, aiDraft: null }
  }
}

export function createDefaultContent(): string {
  return JSON.stringify({ doc: DEFAULT_DOC, aiDraft: null })
}
