import {
  MarkdownSerializer,
  defaultMarkdownSerializer,
  type MarkdownSerializerState,
} from 'prosemirror-markdown'
import type { Node } from 'prosemirror-model'
import type { JsonObject } from './json.js'
import { schema } from './schema.js'

export interface MarkdownParseError {
  kind: 'parse_failed' | 'serialize_failed'
  cause: unknown
}

export type MarkdownResult<T> = { ok: true; value: T } | { ok: false; error: MarkdownParseError }

function codeBlockLanguage(node: Node): string {
  const language = node.attrs.language
  if (typeof language === 'string' && language.length > 0) {
    return language
  }

  const params = node.attrs.params
  if (typeof params === 'string' && params.length > 0) {
    return params
  }

  return ''
}

function serializeCodeBlock(state: MarkdownSerializerState, node: Node) {
  const backticks = node.textContent.match(/`{3,}/gm)
  const fence = backticks ? backticks.sort().slice(-1)[0] + '`' : '```'
  state.write(fence + codeBlockLanguage(node) + '\n')
  state.text(node.textContent, false)
  state.write('\n')
  state.write(fence)
  state.closeBlock(node)
}

function serializeNoteMarker() {
  // Ephemeral editor-only node — omitted from export.
}

function serializeAiZone(state: MarkdownSerializerState, node: Node) {
  state.renderContent(node)
}

export const lucentMarkdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    code_block: serializeCodeBlock,
    note_marker: serializeNoteMarker,
  },
  defaultMarkdownSerializer.marks
)

/** Markdown serializer that unwraps ai_zone inline content for stored-doc export. */
export const lucentExportMarkdownSerializer = new MarkdownSerializer(
  {
    ...lucentMarkdownSerializer.nodes,
    ai_zone: serializeAiZone,
  },
  lucentMarkdownSerializer.marks
)

export function proseMirrorDocToMarkdown(doc: JsonObject): MarkdownResult<string> {
  try {
    const node = schema.nodeFromJSON(doc)
    return { ok: true, value: lucentMarkdownSerializer.serialize(node) }
  } catch (e) {
    return { ok: false, error: { kind: 'serialize_failed', cause: e } }
  }
}

export function proseMirrorDocToExportMarkdown(doc: JsonObject): MarkdownResult<string> {
  try {
    const node = schema.nodeFromJSON(doc)
    return { ok: true, value: lucentExportMarkdownSerializer.serialize(node) }
  } catch (e) {
    return { ok: false, error: { kind: 'serialize_failed', cause: e } }
  }
}
