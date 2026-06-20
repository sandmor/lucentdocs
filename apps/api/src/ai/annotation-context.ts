import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { MarkdownSerializer } from 'prosemirror-markdown'
import {
  lucentMarkdownSerializer,
  parseNoteBodyContent,
  proseMirrorDocToMarkdown,
  schema,
  type JsonObject,
  type NotePlacement,
} from '@lucentdocs/shared'
import { buildPromptContextExcerpt, type ContextParts } from '@lucentdocs/shared'

export interface AiAnnotationNote {
  id: string
  blockId: string
  placement: NotePlacement
  content: string | JsonObject
  createdAt: number
  updatedAt: number
}

export interface AnnotatedContextResult {
  parts: ContextParts
  annotationContent: string
}

const ANNOTATION_CONTENT_MAX_CHARS = 4_000
const OMISSION_LATER = '<omitted content="later"/>'

const markdownSerializer = new MarkdownSerializer(
  {
    ...lucentMarkdownSerializer.nodes,
    ai_zone(state, node) {
      state.renderContent(node)
    },
  },
  lucentMarkdownSerializer.marks
)

type NotesByPlacement = Record<NotePlacement, AiAnnotationNote[]>

interface PromptAliasState {
  aliasByNoteId: Map<string, string>
  aliasToNoteId: Map<string, string>
  nextIndex: number
}

function createPromptAliasState(): PromptAliasState {
  return {
    aliasByNoteId: new Map(),
    aliasToNoteId: new Map(),
    nextIndex: 1,
  }
}

function promptAliasFor(note: AiAnnotationNote, state: PromptAliasState): string {
  const existing = state.aliasByNoteId.get(note.id)
  if (existing) return existing

  const alias = `n${state.nextIndex}`
  state.nextIndex += 1
  state.aliasByNoteId.set(note.id, alias)
  state.aliasToNoteId.set(alias, note.id)
  return alias
}

function comparePromptAliases(left: string, right: string): number {
  return Number(left.slice(1)) - Number(right.slice(1))
}

function createEmptyPlacementGroups(): NotesByPlacement {
  return {
    before: [],
    about: [],
    after: [],
  }
}

function compareNotes(left: AiAnnotationNote, right: AiAnnotationNote): number {
  return left.createdAt - right.createdAt || left.updatedAt - right.updatedAt || left.id.localeCompare(right.id)
}

function groupNotesByBlock(notes: readonly AiAnnotationNote[]): Map<string, NotesByPlacement> {
  const grouped = new Map<string, NotesByPlacement>()
  for (const note of notes) {
    const existing = grouped.get(note.blockId) ?? createEmptyPlacementGroups()
    existing[note.placement].push(note)
    grouped.set(note.blockId, existing)
  }

  for (const groups of grouped.values()) {
    groups.before.sort(compareNotes)
    groups.about.sort(compareNotes)
    groups.after.sort(compareNotes)
  }

  return grouped
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function unescapeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

const ANNOTATION_MARKER_ID_PATTERN = /<annotation id="([^"]*)"/g

export function extractAnnotationIdsFromMarkers(text: string): Set<string> {
  const ids = new Set<string>()
  for (const match of text.matchAll(ANNOTATION_MARKER_ID_PATTERN)) {
    ids.add(unescapeAttribute(match[1]))
  }
  return ids
}

function annotationMarker(note: AiAnnotationNote, aliasState: PromptAliasState): string {
  return `<annotation id="${escapeAttribute(promptAliasFor(note, aliasState))}" />`
}

function wrapAnnotatedBlock(
  text: string,
  notes: readonly AiAnnotationNote[],
  aliasState: PromptAliasState
): string {
  let wrapped = text
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index]
    wrapped = `<annotation id="${escapeAttribute(promptAliasFor(note, aliasState))}">\n${wrapped}\n</annotation>`
  }
  return wrapped
}

function serializeBlockMarkdown(node: ProseMirrorNode): string {
  try {
    const doc = schema.nodes.doc.create(null, [node])
    return markdownSerializer.serialize(doc).trimEnd()
  } catch {
    return node.textBetween(0, node.content.size, '\n\n', '\n').trimEnd()
  }
}

function serializeBlockPlainSlice(
  node: ProseMirrorNode,
  localFrom: number,
  localTo: number
): string {
  return node.textBetween(localFrom, localTo, '\n\n', '\n')
}

function noteBodyToMarkdown(note: AiAnnotationNote): string {
  const content =
    typeof note.content === 'string' ? parseNoteBodyContent(note.content) : note.content
  const rendered = proseMirrorDocToMarkdown(content)
  if (rendered.ok) return rendered.value.trim()
  return ''
}

export function renderAnnotationContent(
  notes: readonly AiAnnotationNote[],
  includedIds: ReadonlySet<string>,
  aliasByNoteId: ReadonlyMap<string, string>
): string {
  if (includedIds.size === 0) return '(none)'

  const includedNotes = notes
    .filter((note) => includedIds.has(note.id))
    .sort((left, right) => {
      const leftAlias = aliasByNoteId.get(left.id)
      const rightAlias = aliasByNoteId.get(right.id)
      if (leftAlias && rightAlias) return comparePromptAliases(leftAlias, rightAlias)
      return compareNotes(left, right)
    })
  const sections: string[] = []
  let remaining = ANNOTATION_CONTENT_MAX_CHARS

  for (const note of includedNotes) {
    if (remaining <= 0) break

    const alias = aliasByNoteId.get(note.id)
    if (!alias) continue

    const body = noteBodyToMarkdown(note) || '(empty annotation)'
    const open = `<annotation_content id="${escapeAttribute(alias)}">`
    const close = '</annotation_content>'
    const wrapperOverhead = open.length + close.length + 2
    const bodyBudget = Math.max(0, remaining - wrapperOverhead)
    const clipped =
      body.length > bodyBudget
        ? `${body.slice(0, Math.max(0, bodyBudget - OMISSION_LATER.length - 1)).trimEnd()}\n${OMISSION_LATER}`
        : body
    const section = `${open}\n${clipped}\n${close}`
    sections.push(section)
    remaining -= section.length + 2
  }

  if (includedNotes.length > sections.length) {
    sections.push(OMISSION_LATER)
  }

  return sections.join('\n\n') || '(none)'
}

function topLevelBlockId(node: ProseMirrorNode): string | null {
  const id = node.attrs.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

function collectUsedNotes(notes: readonly AiAnnotationNote[], includedIds: Set<string>): void {
  for (const note of notes) {
    includedIds.add(note.id)
  }
}

function renderAnnotatedRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  notesByBlock: ReadonlyMap<string, NotesByPlacement>,
  includedIds: Set<string>,
  aliasState: PromptAliasState,
  mode: 'plain' | 'markdown'
): string {
  if (to <= from) return ''

  const chunks: string[] = []
  doc.forEach((node, offset) => {
    const blockStart = offset
    const blockContentStart = offset + 1
    const blockContentEnd = offset + node.nodeSize - 1
    const blockEnd = offset + node.nodeSize
    if (blockEnd < from || blockStart > to) return

    const blockId = topLevelBlockId(node)
    const groups = blockId ? notesByBlock.get(blockId) : undefined

    if (groups && blockStart >= from && blockStart <= to) {
      for (const note of groups.before) {
        chunks.push(annotationMarker(note, aliasState))
        includedIds.add(note.id)
      }
    }

    const includesBlock =
      blockContentEnd > from && blockContentStart < to
        ? true
        : node.content.size === 0 && blockStart >= from && blockEnd <= to

    if (includesBlock) {
      const localFrom =
        mode === 'markdown' ? 0 : Math.max(0, Math.min(node.content.size, from - blockContentStart))
      const localTo =
        mode === 'markdown'
          ? node.content.size
          : Math.max(0, Math.min(node.content.size, to - blockContentStart))
      let text =
        mode === 'markdown'
          ? serializeBlockMarkdown(node)
          : serializeBlockPlainSlice(node, localFrom, localTo)

      if (groups && groups.about.length > 0) {
        text = wrapAnnotatedBlock(text, groups.about, aliasState)
        collectUsedNotes(groups.about, includedIds)
      }

      chunks.push(text)
    }

    if (groups && blockEnd >= from && blockEnd <= to) {
      for (const note of groups.after) {
        chunks.push(annotationMarker(note, aliasState))
        includedIds.add(note.id)
      }
    }
  })

  return chunks.filter((chunk) => chunk.length > 0).join('\n\n')
}

export function buildAnnotatedPromptContextExcerpt(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  budget: number,
  notes: readonly AiAnnotationNote[]
): AnnotatedContextResult {
  const docEnd = doc.content.size
  const clampedFrom = Math.max(0, Math.min(from, docEnd))
  const clampedTo = Math.max(0, Math.min(to, docEnd))
  const safeFrom = Math.min(clampedFrom, clampedTo)
  const safeTo = Math.max(clampedFrom, clampedTo)
  const windowSize = Math.min(docEnd, Math.max(2048, Math.floor(budget * 2)))
  const beforeStart = Math.max(0, safeFrom - windowSize)
  const afterEnd = Math.min(docEnd, safeTo + windowSize)
  const notesByBlock = groupNotesByBlock(notes)
  const includedIds = new Set<string>()
  const aliasState = createPromptAliasState()
  const hasSelection = safeFrom < safeTo

  const rawContextBefore = renderAnnotatedRange(
    doc,
    beforeStart,
    safeFrom,
    notesByBlock,
    includedIds,
    aliasState,
    'plain'
  )
  const markerContent = hasSelection
    ? renderAnnotatedRange(doc, safeFrom, safeTo, notesByBlock, includedIds, aliasState, 'plain')
    : ''
  const rawContextAfter = renderAnnotatedRange(
    doc,
    safeTo,
    afterEnd,
    notesByBlock,
    includedIds,
    aliasState,
    'plain'
  )

  return {
    parts: buildPromptContextExcerpt(
      rawContextBefore,
      hasSelection ? 'selection' : 'caret',
      markerContent,
      safeTo >= docEnd ? undefined : rawContextAfter,
      budget
    ),
    annotationContent: renderAnnotationContent(notes, includedIds, aliasState.aliasByNoteId),
  }
}

export function renderAnnotationContentForPromptMarkerIds(
  notes: readonly AiAnnotationNote[],
  markerIds: ReadonlySet<string>,
  aliasToNoteId: ReadonlyMap<string, string>,
  aliasByNoteId: ReadonlyMap<string, string>
): string {
  const includedIds = new Set<string>()
  for (const markerId of markerIds) {
    const noteId = aliasToNoteId.get(markerId)
    if (noteId) includedIds.add(noteId)
  }
  return renderAnnotationContent(notes, includedIds, aliasByNoteId)
}

export function renderAnnotatedDocumentMarkdown(
  doc: ProseMirrorNode,
  notes: readonly AiAnnotationNote[]
): {
  markdown: string
  annotationContent: string
  aliasByNoteId: Map<string, string>
  aliasToNoteId: Map<string, string>
} {
  const notesByBlock = groupNotesByBlock(notes)
  const includedIds = new Set<string>()
  const aliasState = createPromptAliasState()
  const markdown = renderAnnotatedRange(
    doc,
    0,
    doc.content.size,
    notesByBlock,
    includedIds,
    aliasState,
    'markdown'
  )
  return {
    markdown,
    annotationContent: renderAnnotationContent(notes, includedIds, aliasState.aliasByNoteId),
    aliasByNoteId: aliasState.aliasByNoteId,
    aliasToNoteId: aliasState.aliasToNoteId,
  }
}
