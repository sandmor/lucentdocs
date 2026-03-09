import { parseContent, schema, type Document } from '@lucentdocs/shared'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

export interface DocumentProjectionRange {
  textStart: number
  textEnd: number
  selectionFrom: number
  selectionTo: number
}

export interface DocumentEmbeddingProjection {
  text: string
  ranges: DocumentProjectionRange[]
  graphemeBoundaries: number[]
}

interface ProjectionBuilderState {
  parts: string[]
  length: number
  ranges: DocumentProjectionRange[]
}

function appendUnmappedText(state: ProjectionBuilderState, text: string): void {
  if (!text) return
  state.parts.push(text)
  state.length += text.length
}

function appendMappedText(
  state: ProjectionBuilderState,
  text: string,
  selectionFrom: number,
  selectionTo: number
): void {
  if (!text) return

  const textStart = state.length
  state.parts.push(text)
  state.length += text.length
  state.ranges.push({
    textStart,
    textEnd: state.length,
    selectionFrom,
    selectionTo,
  })
}

function buildGraphemeBoundaries(text: string): number[] {
  const boundaries = [0]
  if (!text) return boundaries

  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let codeUnitOffset = 0

  for (const segment of segmenter.segment(text)) {
    codeUnitOffset += segment.segment.length
    boundaries.push(codeUnitOffset)
  }

  return boundaries
}

function childSeparator(node: ProseMirrorNode): string {
  switch (node.type.name) {
    case 'doc':
    case 'blockquote':
    case 'bullet_list':
    case 'ordered_list':
    case 'list_item':
      return '\n\n'
    default:
      return ''
  }
}

function appendNodeText(
  state: ProjectionBuilderState,
  node: ProseMirrorNode,
  position: number
): void {
  if (node.isText) {
    appendMappedText(state, node.text ?? '', position, position + (node.text?.length ?? 0))
    return
  }

  if (node.type.name === 'hard_break') {
    appendUnmappedText(state, '\n')
    return
  }

  if (node.type.name === 'horizontal_rule') {
    appendUnmappedText(state, '\n')
    return
  }

  const separator = childSeparator(node)
  let previousRendered = false

  node.forEach((child, offset) => {
    if (separator && previousRendered) {
      appendUnmappedText(state, separator)
    }

    const childPosition = position + offset + 1
    const beforeLength = state.length
    appendNodeText(state, child, childPosition)
    const rendered = state.length > beforeLength

    if (!rendered && separator && previousRendered) {
      const trailing = state.parts.pop() ?? ''
      state.length -= trailing.length
    }

    previousRendered = previousRendered || rendered
  })
}

export function buildDocumentEmbeddingProjection(
  document: Pick<Document, 'title'>,
  content: string
): DocumentEmbeddingProjection {
  const bodyState: ProjectionBuilderState = {
    parts: [],
    length: 0,
    ranges: [],
  }

  const parsed = parseContent(content)
  const proseMirrorDoc = schema.nodeFromJSON(parsed.doc)
  appendNodeText(bodyState, proseMirrorDoc, -1)

  const state: ProjectionBuilderState = {
    parts: [],
    length: 0,
    ranges: [],
  }

  const title = document.title.trim()
  if (title) {
    appendUnmappedText(state, title)
    if (bodyState.length > 0) {
      appendUnmappedText(state, '\n\n')
    }
  }

  const bodyOffset = state.length
  for (const part of bodyState.parts) {
    state.parts.push(part)
  }
  state.length += bodyState.length
  for (const range of bodyState.ranges) {
    state.ranges.push({
      textStart: range.textStart + bodyOffset,
      textEnd: range.textEnd + bodyOffset,
      selectionFrom: range.selectionFrom,
      selectionTo: range.selectionTo,
    })
  }

  const fullText = state.parts.join('')
  const text = fullText.trim()
  if (!text) {
    return {
      text: '',
      ranges: [],
      graphemeBoundaries: [0],
    }
  }

  const trimStart = fullText.indexOf(text)
  const trimEnd = trimStart + text.length
  const ranges = state.ranges
    .map((range) => ({
      textStart: Math.max(trimStart, range.textStart),
      textEnd: Math.min(trimEnd, range.textEnd),
      selectionFrom: range.selectionFrom,
      selectionTo: range.selectionTo,
      originalTextStart: range.textStart,
    }))
    .filter((range) => range.textEnd > range.textStart)
    .map((range) => ({
      textStart: range.textStart - trimStart,
      textEnd: range.textEnd - trimStart,
      selectionFrom: range.selectionFrom + (range.textStart - range.originalTextStart),
      selectionTo: range.selectionFrom + (range.textEnd - range.originalTextStart),
    }))

  return {
    text,
    ranges,
    graphemeBoundaries: buildGraphemeBoundaries(text),
  }
}

export function mapProjectionGraphemeRangeToSelection(
  projection: DocumentEmbeddingProjection,
  start: number,
  end: number
): { from: number; to: number } | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    return null
  }

  const codeUnitStart = projection.graphemeBoundaries[start]
  const codeUnitEnd = projection.graphemeBoundaries[end]
  if (codeUnitStart === undefined || codeUnitEnd === undefined || codeUnitEnd <= codeUnitStart) {
    return null
  }

  let mappedFrom: number | null = null
  let mappedTo: number | null = null

  for (const range of projection.ranges) {
    const overlapStart = Math.max(codeUnitStart, range.textStart)
    const overlapEnd = Math.min(codeUnitEnd, range.textEnd)
    if (overlapEnd <= overlapStart) continue

    const startOffset = overlapStart - range.textStart
    const endOffset = overlapEnd - range.textStart
    const nextFrom = range.selectionFrom + startOffset
    const nextTo = range.selectionFrom + endOffset

    mappedFrom = mappedFrom === null ? nextFrom : Math.min(mappedFrom, nextFrom)
    mappedTo = mappedTo === null ? nextTo : Math.max(mappedTo, nextTo)
  }

  if (mappedFrom === null || mappedTo === null || mappedTo <= mappedFrom) {
    return null
  }

  return { from: mappedFrom, to: mappedTo }
}
