import {
  parseNoteBodyContent,
  proseMirrorDocToMarkdown,
  type JsonObject,
} from '@lucentdocs/shared'
import { renderDocumentContentToMarkdown } from '../../core/services/documentContent.js'
import { parseDocumentNode } from '../../core/services/documentContent.js'
import type { ServiceSet } from '../../core/services/types.js'
import {
  extractAnnotationIdsFromMarkers,
  renderAnnotatedDocumentMarkdown,
  type AiAnnotationNote,
} from '../../ai/annotation-context.js'
import {
  formatXmlCloseTag,
  formatXmlElement,
  formatXmlOpenTag,
  formatXmlSelfClosingTag,
} from './structured-output.js'

export interface LoadedDocumentText {
  documentId: string
  path: string
  content: string
  plainManuscript: string
  noteRows: AiAnnotationNote[]
  aliasByNoteId: Map<string, string>
  aliasToNoteId: Map<string, string>
}

export async function loadDocumentText(
  services: ServiceSet,
  projectId: string,
  documentId: string,
  path: string,
  options: { includeAnnotations: boolean }
): Promise<LoadedDocumentText | null> {
  const document = await services.documents.getForProject(projectId, documentId)
  if (!document) return null

  const noteRows = await services.documentNotes.listByDocumentId(documentId)
  const plainManuscript = renderDocumentContentToMarkdown(document.content)
  let content = plainManuscript
  let aliasByNoteId = new Map<string, string>()
  let aliasToNoteId = new Map<string, string>()

  if (options.includeAnnotations && noteRows.length > 0) {
    const documentNode = parseDocumentNode(document.content)
    if (documentNode) {
      const annotated = renderAnnotatedDocumentMarkdown(documentNode, noteRows)
      content = annotated.markdown
      aliasByNoteId = annotated.aliasByNoteId
      aliasToNoteId = annotated.aliasToNoteId
    }
  }

  return {
    documentId,
    path,
    content,
    plainManuscript,
    noteRows,
    aliasByNoteId,
    aliasToNoteId,
  }
}

export function stripAnnotationMarkup(text: string): string {
  return text
    .replace(/<annotation id="[^"]*">\n?/g, '')
    .replace(/\n?<\/annotation>/g, '')
    .replace(/<annotation id="[^"]*" \/>/g, '')
}

function noteBodyToMarkdown(note: AiAnnotationNote): string {
  const content =
    typeof note.content === 'string' ? parseNoteBodyContent(note.content) : (note.content as JsonObject)
  const rendered = proseMirrorDocToMarkdown(content)
  if (rendered.ok) return rendered.value.trim()
  return ''
}

export function formatAnnotationBlock(
  noteRows: readonly AiAnnotationNote[],
  markerIds: ReadonlySet<string>,
  aliasToNoteId: ReadonlyMap<string, string>
): string {
  const sections: string[] = []

  for (const markerId of markerIds) {
    const noteId = aliasToNoteId.get(markerId)
    if (!noteId) continue
    const note = noteRows.find((row) => row.id === noteId)
    if (!note) continue
    const body = noteBodyToMarkdown(note) || '(empty annotation)'
    sections.push(
      formatXmlElement('annotation', {
        attributes: { id: markerId, anchor: note.anchorKind },
        text: body,
      })
    )
  }

  return sections.join('\n')
}

export function buildAnnotationBlockForSlice(
  noteRows: readonly AiAnnotationNote[],
  sliceText: string,
  aliasToNoteId: ReadonlyMap<string, string>
): string {
  const markerIds = extractAnnotationIdsFromMarkers(sliceText)
  if (markerIds.size === 0) return ''
  return formatAnnotationBlock(noteRows, markerIds, aliasToNoteId)
}

export function formatReadFileOutput(options: {
  path: string
  lines: string[]
  startLine: number
  endLine: number
  totalLines: number
  annotationsBlock: string
  truncated: boolean
  nextOffset: number | null
}): string {
  const numbered = options.lines
    .map((line, index) => `${options.startLine + index}: ${line}`)
    .join('\n')

  const metaAttributes: Record<string, string | number | boolean> = {
    truncated: options.truncated,
  }
  if (options.nextOffset !== null) {
    metaAttributes.next_offset = options.nextOffset
  }

  const parts = [
    formatXmlOpenTag('document', { path: options.path }),
    formatXmlOpenTag('lines', {
      start: options.startLine,
      end: options.endLine,
      total: options.totalLines,
    }),
    numbered,
    formatXmlCloseTag('lines'),
  ]

  if (options.annotationsBlock.length > 0) {
    parts.push(
      formatXmlOpenTag('annotations'),
      options.annotationsBlock,
      formatXmlCloseTag('annotations')
    )
  }

  parts.push(formatXmlSelfClosingTag('meta', metaAttributes), formatXmlCloseTag('document'))

  return parts.join('\n')
}

export function formatReadDirectoryOutput(options: {
  path: string
  entries: string[]
  offset: number
  totalEntries: number
  truncated: boolean
  nextOffset: number | null
}): string {
  const displayPath = options.path || '/'
  const metaAttributes: Record<string, string | number | boolean> = {
    truncated: options.truncated,
    total_entries: options.totalEntries,
    offset: options.offset,
  }
  if (options.nextOffset !== null) {
    metaAttributes.next_offset = options.nextOffset
  }

  return [
    formatXmlOpenTag('directory', { path: displayPath }),
    ...options.entries,
    formatXmlCloseTag('directory'),
    formatXmlSelfClosingTag('meta', metaAttributes),
  ].join('\n')
}
