import { defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown'
import type { JsonObject } from './json.js'
import { schema } from './schema.js'

export interface MarkdownParseError {
  kind: 'parse_failed' | 'serialize_failed'
  cause: unknown
}

export type MarkdownResult<T> = { ok: true; value: T } | { ok: false; error: MarkdownParseError }

export function markdownToProseMirrorDoc(markdown: string): MarkdownResult<JsonObject> {
  try {
    const doc = defaultMarkdownParser.parse(markdown)
    return { ok: true, value: doc.toJSON() as JsonObject }
  } catch (e) {
    return { ok: false, error: { kind: 'parse_failed', cause: e } }
  }
}

export function proseMirrorDocToMarkdown(doc: JsonObject): MarkdownResult<string> {
  try {
    const node = schema.nodeFromJSON(doc)
    return { ok: true, value: defaultMarkdownSerializer.serialize(node) }
  } catch (e) {
    return { ok: false, error: { kind: 'serialize_failed', cause: e } }
  }
}
