import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { ySyncPluginKey } from 'y-prosemirror'
import { gapBreaksZoneSegmentChain } from '@lucentdocs/shared'
import { getAIZones, type AIZone, aiWriterPluginKey } from './writer-plugin'

const STRUCTURAL_GAP_BLOCK_TYPES = new Set(['code_block', 'horizontal_rule'])

export const AI_ZONE_ALLOWED_META = 'aiZoneAllowDocChange'

const ALLOWED_WRITER_META_TYPES = new Set(['start', 'accept', 'reject', 'stop'])

export interface ProtectedZoneRange {
  from: number
  to: number
}

function collectStructuralGapBlockRanges(
  doc: ProseMirrorNode,
  from: number,
  to: number
): ProtectedZoneRange[] {
  const ranges: ProtectedZoneRange[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (STRUCTURAL_GAP_BLOCK_TYPES.has(node.type.name) && node.isBlock) {
      ranges.push({ from: pos, to: pos + node.nodeSize })
    }
    return true
  })
  return ranges
}

export function getProtectionRangesForZones(
  doc: ProseMirrorNode,
  zones: AIZone[]
): ProtectedZoneRange[] {
  const ranges: ProtectedZoneRange[] = []

  for (const zone of zones) {
    const sortedSegments = [...zone.segments].sort((left, right) => left.nodeFrom - right.nodeFrom)

    for (const segment of sortedSegments) {
      if (segment.nodeFrom < segment.nodeTo) {
        ranges.push({ from: segment.nodeFrom, to: segment.nodeTo })
      }
    }

    for (let index = 0; index < sortedSegments.length - 1; index += 1) {
      const left = sortedSegments[index]
      const right = sortedSegments[index + 1]
      if (gapBreaksZoneSegmentChain(doc, left.nodeTo, right.nodeFrom)) {
        continue
      }
      ranges.push(...collectStructuralGapBlockRanges(doc, left.nodeTo, right.nodeFrom))
    }
  }

  return ranges
}

export function getProtectedZoneRanges(view: EditorView): ProtectedZoneRange[] {
  return getProtectionRangesForZones(view.state.doc, getAIZones(view))
}

export function getProtectedZoneRangesFromZones(
  doc: ProseMirrorNode,
  zones: AIZone[]
): ProtectedZoneRange[] {
  return getProtectionRangesForZones(doc, zones)
}

export function rangeOverlapsProtectedZone(
  ranges: ProtectedZoneRange[],
  from: number,
  to: number
): boolean {
  if (from >= to) return false
  return ranges.some((range) => from < range.to && to > range.from)
}

export function blockOverlapsProtectedZone(
  view: EditorView,
  blockPos: number,
  blockSize: number
): boolean {
  if (rangeOverlapsProtectedZone(getProtectedZoneRanges(view), blockPos, blockPos + blockSize)) {
    return true
  }

  const blockDom = view.nodeDOM(blockPos)
  if (blockDom instanceof HTMLElement) {
    return blockDom.querySelector('.ai-generating-text') !== null
  }

  return false
}

export function hasStreamingAIZone(view: EditorView): boolean {
  return getAIZones(view).some((zone) => zone.streaming)
}

function positionStrictlyInsideRange(position: number, range: ProtectedZoneRange): boolean {
  return position > range.from && position < range.to
}

/** Strict open interval on inline segment bounds; boundary positions are outside zone content. */
export function positionStrictlyInsideZoneContent(position: number, zone: AIZone): boolean {
  return zone.segments.some(
    (segment) => position > segment.nodeFrom && position < segment.nodeTo
  )
}

export function selectionHeadStrictlyInsideZones(
  head: number,
  zones: AIZone[],
  doc: ProseMirrorNode
): boolean {
  const ranges = getProtectionRangesForZones(doc, zones)
  return ranges.some((range) => positionStrictlyInsideRange(head, range))
}

function stepTouchesRange(
  step: { from: number; to: number },
  rangeFrom: number,
  rangeTo: number
): boolean {
  return step.from < rangeTo && step.to > rangeFrom
}

function mapRangesThroughSteps(
  ranges: ProtectedZoneRange[],
  steps: Transaction['steps'],
  stepCount: number
): ProtectedZoneRange[] {
  let mapped = ranges
  for (let index = 0; index < stepCount; index += 1) {
    const map = steps[index].getMap()
    mapped = mapped.map((range) => ({
      from: map.map(range.from, -1),
      to: map.map(range.to, 1),
    }))
  }
  return mapped
}

export function transactionTouchesProtectedZones(
  tr: Transaction,
  ranges: ProtectedZoneRange[]
): boolean {
  if (!tr.docChanged || ranges.length === 0) return false

  for (let stepIndex = 0; stepIndex < tr.steps.length; stepIndex += 1) {
    const step = tr.steps[stepIndex]
    const json = step.toJSON() as { from?: number; to?: number; pos?: number }
    const from = typeof json.from === 'number' ? json.from : typeof json.pos === 'number' ? json.pos : null
    const to = typeof json.to === 'number' ? json.to : typeof json.pos === 'number' ? json.pos : null
    if (from === null || to === null) {
      return true
    }

    const mappedRanges = mapRangesThroughSteps(ranges, tr.steps, stepIndex)
    for (const range of mappedRanges) {
      if (stepTouchesRange({ from, to }, range.from, range.to)) {
        return true
      }
    }
  }

  return false
}

export function isAllowedAIZoneDocumentTransaction(tr: Transaction): boolean {
  if (!tr.docChanged) return true

  if (tr.getMeta(AI_ZONE_ALLOWED_META) === true) {
    return true
  }

  const writerMeta = tr.getMeta(aiWriterPluginKey) as { type?: string } | undefined
  if (writerMeta?.type && ALLOWED_WRITER_META_TYPES.has(writerMeta.type)) {
    return true
  }

  const syncMeta = tr.getMeta(ySyncPluginKey) as
    | { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean }
    | undefined
  if (syncMeta?.isChangeOrigin || syncMeta?.isUndoRedoOperation) {
    return true
  }

  return false
}

export function shouldFilterAIZoneDocumentTransaction(
  tr: Transaction,
  ranges: ProtectedZoneRange[]
): boolean {
  if (!tr.docChanged || ranges.length === 0) return false
  if (isAllowedAIZoneDocumentTransaction(tr)) return false
  return transactionTouchesProtectedZones(tr, ranges)
}

export function tagAIZoneAllowedTransaction(tr: Transaction): Transaction {
  return tr.setMeta(AI_ZONE_ALLOWED_META, true)
}
