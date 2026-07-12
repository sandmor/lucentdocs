import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { serializeTopLevelBlock } from './document-manuscript.js'

export interface ManuscriptTopLevelEntry {
  index: number
  pos: number
  nodeSize: number
  node: ProseMirrorNode
  kind: 'content' | 'marker'
  blockId: string | null
  textStart: number | null
  textEnd: number | null
}

export interface ManuscriptProjection {
  text: string
  entries: ManuscriptTopLevelEntry[]
}

export function projectDocumentEntries(doc: ProseMirrorNode): ManuscriptProjection {
  const entries: ManuscriptTopLevelEntry[] = []
  const parts: string[] = []
  let textLength = 0

  doc.forEach((node, offset, index) => {
    if (node.type.name === 'note_marker') {
      entries.push({
        index,
        pos: offset,
        nodeSize: node.nodeSize,
        node,
        kind: 'marker',
        blockId: typeof node.attrs.id === 'string' ? node.attrs.id : null,
        textStart: null,
        textEnd: null,
      })
      return
    }

    const blockText = serializeTopLevelBlock(node)
    if (parts.length > 0) {
      parts.push('\n\n')
      textLength += 2
    }

    const textStart = textLength
    parts.push(blockText)
    textLength += blockText.length

    entries.push({
      index,
      pos: offset,
      nodeSize: node.nodeSize,
      node,
      kind: 'content',
      blockId: typeof node.attrs.id === 'string' ? node.attrs.id : null,
      textStart,
      textEnd: textLength,
    })
  })

  return {
    text: parts.join('').trimEnd(),
    entries,
  }
}

export function resolveManuscriptRangeToDocRange(
  projection: ManuscriptProjection,
  start: number,
  end: number
): { from: number; to: number; entries: ManuscriptTopLevelEntry[] } {
  const affected = projection.entries.filter((entry) => {
    if (entry.kind !== 'content' || entry.textStart === null || entry.textEnd === null) {
      return false
    }
    return entry.textStart < end && entry.textEnd > start
  })

  if (affected.length === 0) {
    throw new Error('Matched manuscript range does not map to editable document content.')
  }

  const first = affected[0]
  const last = affected[affected.length - 1]
  const firstOffset = Math.max(0, start - (first.textStart ?? 0))
  const lastOffset = Math.min((last.textEnd ?? 0) - (last.textStart ?? 0), end - (last.textStart ?? 0))

  const from = first.pos + 1 + offsetToInnerPos(first.node, firstOffset)
  const to = last.pos + 1 + offsetToInnerPos(last.node, lastOffset)

  return { from, to, entries: affected }
}

function offsetToInnerPos(node: ProseMirrorNode, targetOffset: number): number {
  const serialized = serializeTopLevelBlock(node)
  const clamped = Math.max(0, Math.min(targetOffset, serialized.length))
  if (clamped === 0) return 0
  if (clamped >= serialized.length) return node.content.size

  let lo = 0
  let hi = node.content.size
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    const prefix = node.textBetween(0, mid, '\n\n', '\n')
    if (prefix.length <= clamped) lo = mid
    else hi = mid - 1
  }

  return lo
}

export function sliceTopLevelEntries(
  projection: ManuscriptProjection,
  affectedContent: ManuscriptTopLevelEntry[]
): ManuscriptTopLevelEntry[] {
  if (affectedContent.length === 0) return []
  const firstIndex = affectedContent[0].index
  const lastIndex = affectedContent[affectedContent.length - 1].index
  return projection.entries.filter((entry) => entry.index >= firstIndex && entry.index <= lastIndex)
}
