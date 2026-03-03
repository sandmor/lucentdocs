import { Fragment, Slice, type Node as ProseMirrorNode, type NodeType } from 'prosemirror-model'
import { parseMarkdownishToSlice } from './markdownish.js'

export interface AIZoneAttrs {
  id: string
  streaming: boolean
  sessionId: string | null
  originalSlice: string | null
}

export function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function hasMeaningfulGap(doc: ProseMirrorNode, from: number, to: number): boolean {
  if (to <= from) return false
  return doc.textBetween(from, to, '\n\n', '\n').trim().length > 0
}

export function parseZoneNodeAttrs(
  nodeAttrs: unknown,
  options?: { requireSessionId?: boolean }
): AIZoneAttrs | null {
  if (typeof nodeAttrs !== 'object' || nodeAttrs === null || Array.isArray(nodeAttrs)) {
    return null
  }

  const attrs = nodeAttrs as Record<string, unknown>
  const id = readTrimmedString(attrs.id)
  if (!id) return null

  const sessionId = readTrimmedString(attrs.sessionId)
  if (options?.requireSessionId && !sessionId) return null

  const streaming = attrs.streaming === true
  const originalSlice = readTrimmedString(attrs.originalSlice)

  return {
    id,
    streaming,
    sessionId,
    originalSlice,
  }
}

export function wrapFragmentWithZoneNodes(
  fragment: Fragment,
  nodeType: NodeType,
  attrs: AIZoneAttrs,
  parentAllowsZone: boolean
): Fragment {
  const output: ProseMirrorNode[] = []
  const inlineRun: ProseMirrorNode[] = []

  const flushInlineRun = () => {
    if (inlineRun.length === 0) return

    if (parentAllowsZone) {
      output.push(nodeType.create(attrs, Fragment.fromArray([...inlineRun])))
    } else {
      output.push(...inlineRun)
    }

    inlineRun.length = 0
  }

  fragment.forEach((child) => {
    if (child.isInline) {
      inlineRun.push(child)
      return
    }

    flushInlineRun()
    output.push(wrapNodeWithZoneNodes(child, nodeType, attrs))
  })

  flushInlineRun()

  return Fragment.fromArray(output)
}

export function wrapNodeWithZoneNodes(
  node: ProseMirrorNode,
  nodeType: NodeType,
  attrs: AIZoneAttrs
): ProseMirrorNode {
  if (node.isLeaf || node.content.childCount === 0) {
    return node
  }

  const parentAllowsZone = node.type.contentMatch.matchType(nodeType) !== null
  const wrappedContent = wrapFragmentWithZoneNodes(node.content, nodeType, attrs, parentAllowsZone)
  return node.copy(wrappedContent)
}

export function wrapSliceWithZoneNodes(
  slice: Slice,
  nodeType: NodeType,
  attrs: AIZoneAttrs
): Slice {
  const wrappedContent = wrapFragmentWithZoneNodes(slice.content, nodeType, attrs, true)
  return new Slice(wrappedContent, slice.openStart, slice.openEnd)
}

export function createWrappedZoneSliceFromText(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  text: string,
  nodeType: NodeType,
  attrs: AIZoneAttrs
): Slice {
  const docSize = doc.content.size
  const clampedFrom = Math.max(0, Math.min(from, docSize))
  const clampedTo = Math.max(0, Math.min(to, docSize))
  const rangeFrom = Math.min(clampedFrom, clampedTo)
  const rangeTo = Math.max(clampedFrom, clampedTo)

  const $from = doc.resolve(rangeFrom)
  const $to = doc.resolve(rangeTo)
  const replacement = parseMarkdownishToSlice(text, {
    openStart: $from.parent.inlineContent,
    openEnd: $to.parent.inlineContent,
  })

  return wrapSliceWithZoneNodes(replacement, nodeType, attrs)
}
