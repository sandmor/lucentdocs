import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { ContextParts } from '@lucentdocs/shared'
import { buildPromptContextExcerpt } from '@lucentdocs/shared'

export interface InlinePromptContextResult {
  parts: ContextParts
  selectionFrom: number
  selectionTo: number
}

export function getPromptContextForRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  budget: number
): InlinePromptContextResult {
  const docEnd = doc.content.size
  const clampedFrom = Math.max(0, Math.min(from, docEnd))
  const clampedTo = Math.max(0, Math.min(to, docEnd))
  const safeFrom = Math.min(clampedFrom, clampedTo)
  const safeTo = Math.max(clampedFrom, clampedTo)

  // Avoid materializing full document text for very large documents. We only need
  // a local window around the selection/caret, and prompt-excerpting enforces the
  // final budget. ProseMirror positions roughly correlate with characters.
  const windowSize = Math.min(docEnd, Math.max(2048, Math.floor(budget * 2)))
  const beforeStart = Math.max(0, safeFrom - windowSize)
  const afterEnd = Math.min(docEnd, safeTo + windowSize)

  const rawContextBefore = doc.textBetween(beforeStart, safeFrom, '\n\n', '\n')
  const hasSelection = safeFrom < safeTo
  const markerContent = hasSelection ? doc.textBetween(safeFrom, safeTo, '\n\n', '\n') : ''
  const markerKind = hasSelection ? ('selection' as const) : ('caret' as const)
  const rawContextAfter = doc.textBetween(safeTo, afterEnd, '\n\n', '\n')

  const parts = buildPromptContextExcerpt(
    rawContextBefore,
    markerKind,
    markerContent,
    safeTo >= docEnd ? undefined : rawContextAfter,
    budget
  )

  return {
    parts,
    selectionFrom: safeFrom,
    selectionTo: safeTo,
  }
}
