import { type Node as ProseMirrorNode, type Slice } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { ySyncPluginKey } from 'y-prosemirror'
import { gapBreaksZoneSegmentChain, parseZoneNodeAttrs } from '@lucentdocs/shared'
import {
  AI_ZONE_ALLOWED_META,
  getProtectionRangesForZones,
  getProtectedZoneRangesFromZones,
  positionStrictlyInsideZoneContent,
  selectionHeadStrictlyInsideZones,
  shouldFilterAIZoneDocumentTransaction,
} from './ai-zone-protection'
import { resolvePendingReviewZone } from './ai-zone-undo-target'
import { consumeAbsoluteSelectionSnapshotBeforeRemoteTx } from '../prosemirror/yjs-selection-patch'

interface AIZoneSegment {
  nodeFrom: number
  nodeTo: number
}

export interface AIZone {
  id: string
  nodeFrom: number
  nodeTo: number
  segments: AIZoneSegment[]
  streaming: boolean
  sessionId: string | null
  originalSlice: string | null
}

export interface AIWriterState {
  active: boolean
  zoneId: string | null
  sessionId: string | null
  from: number | null
  to: number | null
  streaming: boolean
  stuck: boolean
  originalSlice: Slice | null
  originalFrom: number | null
  originalSelectionFrom: number | null
  originalSelectionTo: number | null
  preGenerationAnchor: number | null
  userPlacedCaretInZone: boolean
  zones: AIZone[]
}

export interface AIWriterActionHandlers {
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
  onCancelAI: (view: EditorView, options?: { preserveDoc?: boolean }) => void
}

export const aiWriterPluginKey = new PluginKey<AIWriterState>('ai_writer')

function isAIZoneEqual(a: AIZone, b: AIZone): boolean {
  if (a.id !== b.id) return false
  if (a.nodeFrom !== b.nodeFrom) return false
  if (a.nodeTo !== b.nodeTo) return false
  if (a.streaming !== b.streaming) return false
  if (a.sessionId !== b.sessionId) return false
  if (a.originalSlice !== b.originalSlice) return false
  if (a.segments.length !== b.segments.length) return false
  for (let i = 0; i < a.segments.length; i++) {
    if (a.segments[i].nodeFrom !== b.segments[i].nodeFrom) return false
    if (a.segments[i].nodeTo !== b.segments[i].nodeTo) return false
  }
  return true
}

function isAIWriterStateEqual(a: AIWriterState, b: AIWriterState): boolean {
  if (a.active !== b.active) return false
  if (a.zoneId !== b.zoneId) return false
  if (a.sessionId !== b.sessionId) return false
  if (a.from !== b.from) return false
  if (a.to !== b.to) return false
  if (a.streaming !== b.streaming) return false
  if (a.stuck !== b.stuck) return false
  if (a.originalSlice !== b.originalSlice) return false
  if (a.originalFrom !== b.originalFrom) return false
  if (a.originalSelectionFrom !== b.originalSelectionFrom) return false
  if (a.originalSelectionTo !== b.originalSelectionTo) return false
  if (a.preGenerationAnchor !== b.preGenerationAnchor) return false
  if (a.userPlacedCaretInZone !== b.userPlacedCaretInZone) return false
  if (a.zones.length !== b.zones.length) return false
  for (let i = 0; i < a.zones.length; i++) {
    if (!isAIZoneEqual(a.zones[i], b.zones[i])) return false
  }
  return true
}

function collectInvalidAIZoneNodePositions(
  doc: ProseMirrorNode,
  activeZoneId: string | null
): number[] {
  const zoneType = doc.type.schema.nodes.ai_zone
  if (!zoneType) return []

  const positions: number[] = []
  const lastNodeToById = new Map<string, number>()
  doc.descendants((node, pos) => {
    if (node.type !== zoneType) return true
    const parsed = parseZoneNodeAttrs(node.attrs)
    if (!parsed) {
      positions.push(pos)
      return false
    }

    if (activeZoneId !== null && parsed.id === activeZoneId) {
      lastNodeToById.set(parsed.id, pos + node.nodeSize)
      return false
    }

    const previousNodeTo = lastNodeToById.get(parsed.id)
    if (previousNodeTo !== undefined && gapBreaksZoneSegmentChain(doc, previousNodeTo, pos)) {
      positions.push(pos)
      return false
    }

    lastNodeToById.set(parsed.id, pos + node.nodeSize)
    return false
  })

  return positions.sort((left, right) => right - left)
}

function collectAIZones(doc: ProseMirrorNode): AIZone[] {
  const zoneType = doc.type.schema.nodes.ai_zone
  if (!zoneType) return []

  const byId = new Map<string, AIZone>()

  doc.descendants((node, pos) => {
    if (node.type !== zoneType) return true

    const parsed = parseZoneNodeAttrs(node.attrs)
    if (!parsed) return false

    const segment: AIZoneSegment = {
      nodeFrom: pos,
      nodeTo: pos + node.nodeSize,
    }

    const existing = byId.get(parsed.id)
    if (!existing) {
      byId.set(parsed.id, {
        ...parsed,
        nodeFrom: segment.nodeFrom,
        nodeTo: segment.nodeTo,
        segments: [segment],
      })
      return false
    }

    if (gapBreaksZoneSegmentChain(doc, existing.nodeTo, segment.nodeFrom)) {
      return false
    }

    existing.nodeFrom = Math.min(existing.nodeFrom, segment.nodeFrom)
    existing.nodeTo = Math.max(existing.nodeTo, segment.nodeTo)
    existing.streaming = existing.streaming || parsed.streaming

    if (!existing.sessionId && parsed.sessionId) {
      existing.sessionId = parsed.sessionId
    }
    if (!existing.originalSlice && parsed.originalSlice) {
      existing.originalSlice = parsed.originalSlice
    }

    existing.segments.push(segment)
    return false
  })

  return [...byId.values()]
    .map((zone) => ({
      ...zone,
      segments: zone.segments.sort((left, right) => left.nodeFrom - right.nodeFrom),
    }))
    .sort((left, right) => left.nodeFrom - right.nodeFrom)
}

function createInactiveState(zones: AIZone[] = []): AIWriterState {
  return {
    active: false,
    zoneId: null,
    sessionId: null,
    from: null,
    to: null,
    streaming: false,
    stuck: false,
    originalSlice: null,
    originalFrom: null,
    originalSelectionFrom: null,
    originalSelectionTo: null,
    preGenerationAnchor: null,
    userPlacedCaretInZone: false,
    zones,
  }
}

function mapPositionThroughTransactions(
  position: number,
  transactions: readonly { docChanged: boolean; mapping: { map: (pos: number, bias?: number) => number } }[]
): number {
  let mapped = position
  for (const transaction of transactions) {
    if (transaction.docChanged) {
      mapped = transaction.mapping.map(mapped, -1)
    }
  }
  return mapped
}

function getWriterMeta(
  transaction: import('prosemirror-state').Transaction
): { type?: string } | undefined {
  return transaction.getMeta(aiWriterPluginKey) as { type?: string } | undefined
}

function shouldRevertIllegalInsideZoneSelection(
  transactions: readonly import('prosemirror-state').Transaction[],
  oldState: import('prosemirror-state').EditorState,
  doc: ProseMirrorNode,
  currentHead: number,
  snapshot: { anchor: number; head: number }
): { anchor: number; head: number } | null {
  const oldZones = collectAIZones(oldState.doc)
  const newZones = collectAIZones(doc)
  const wasInside = selectionHeadStrictlyInsideZones(snapshot.head, oldZones, oldState.doc)
  const nowInside = selectionHeadStrictlyInsideZones(currentHead, newZones, doc)
  if (!nowInside || wasInside) return null

  const anchor = mapPositionThroughTransactions(snapshot.anchor, transactions)
  const head = mapPositionThroughTransactions(snapshot.head, transactions)
  const docSize = doc.content.size
  return {
    anchor: Math.max(0, Math.min(anchor, docSize)),
    head: Math.max(0, Math.min(head, docSize)),
  }
}

function protectedRanges(state: AIWriterState, doc: ProseMirrorNode): Array<{ from: number; to: number }> {
  return getProtectionRangesForZones(doc, state.zones)
}

function findZoneById(zones: AIZone[], zoneId: string | null): AIZone | null {
  if (!zoneId) return null
  return zones.find((zone) => zone.id === zoneId) ?? null
}

function findAddedPendingReviewZones(doc: ProseMirrorNode, previousDoc: ProseMirrorNode): AIZone[] {
  const previousIds = new Set(collectAIZones(previousDoc).map((zone) => zone.id))
  return collectAIZones(doc).filter(
    (zone) => !zone.streaming && zone.sessionId && !previousIds.has(zone.id)
  )
}

export function getPrimaryAIZoneFromState(state: AIWriterState | null | undefined): AIZone | null {
  if (!state) return null

  const localZone = findZoneById(state.zones, state.zoneId)
  if (localZone) {
    return localZone
  }

  return state.zones.find((zone) => zone.streaming) ?? state.zones[0] ?? null
}

export function getAIZones(view: EditorView): AIZone[] {
  const state = aiWriterPluginKey.getState(view.state)
  return state?.zones ?? []
}

export function sessionIdsWithEndedZoneStreaming(
  previousZones: AIZone[],
  nextZones: AIZone[]
): string[] {
  const endedSessionIds: string[] = []

  for (const previousZone of previousZones) {
    if (!previousZone.streaming || !previousZone.sessionId) continue

    const nextZone = nextZones.find(
      (zone) =>
        zone.id === previousZone.id &&
        (zone.sessionId ?? null) === (previousZone.sessionId ?? null)
    )
    if (nextZone && !nextZone.streaming) {
      endedSessionIds.push(previousZone.sessionId)
    }
  }

  return endedSessionIds
}

export function createAIWriterPlugin(handlers: AIWriterActionHandlers): Plugin {
  return new Plugin({
    key: aiWriterPluginKey,
    filterTransaction(tr, state) {
      const pluginState = aiWriterPluginKey.getState(state)
      const ranges = getProtectedZoneRangesFromZones(state.doc, pluginState?.zones ?? [])
      return !shouldFilterAIZoneDocumentTransaction(tr, ranges)
    },
    state: {
      init(_config, instanceState): AIWriterState {
        const zones = collectAIZones(instanceState.doc)
        return createInactiveState(zones)
      },
      apply(tr, value): AIWriterState {
        const meta = tr.getMeta(aiWriterPluginKey)
        let next = value

        if (meta?.type === 'start') {
          next = {
            ...next,
            active: true,
            zoneId: typeof meta.zoneId === 'string' ? meta.zoneId : null,
            sessionId: typeof meta.sessionId === 'string' ? meta.sessionId : null,
            from: meta.pos,
            to: meta.pos,
            streaming: true,
            stuck: false,
            originalSlice: meta.originalSlice ?? null,
            originalFrom: meta.originalSlice ? (meta.originalFrom ?? null) : null,
            originalSelectionFrom: meta.selectionFrom ?? meta.pos,
            originalSelectionTo: meta.selectionTo ?? meta.pos,
            preGenerationAnchor:
              typeof meta.preGenerationAnchor === 'number' ? meta.preGenerationAnchor : null,
            userPlacedCaretInZone: false,
          }
        }

        if (meta?.type === 'streaming_stop') {
          next = { ...next, streaming: false, stuck: false }
        }

        if (meta?.type === 'stuck_start') {
          next = { ...next, stuck: true }
        }

        if (meta?.type === 'stuck_stop') {
          next = { ...next, stuck: false }
        }

        if (meta?.type === 'resume_review') {
          const zones = collectAIZones(tr.doc)
          const zoneId = typeof meta.zoneId === 'string' ? meta.zoneId : null
          const zone = findZoneById(zones, zoneId)
          if (zone) {
            next = {
              ...next,
              active: true,
              zoneId: zone.id,
              sessionId:
                typeof meta.sessionId === 'string' ? meta.sessionId : (zone.sessionId ?? null),
              from: zone.nodeFrom,
              to: zone.nodeTo,
              streaming: false,
              stuck: false,
              originalSlice: null,
              originalFrom: null,
              originalSelectionFrom: null,
              originalSelectionTo: null,
              preGenerationAnchor: null,
              userPlacedCaretInZone: false,
            }
          }
        }

        if (meta?.type === 'stop' || meta?.type === 'accept' || meta?.type === 'reject') {
          next = createInactiveState(next.zones)
        }

        if (tr.selectionSet) {
          const zones = collectAIZones(tr.doc)
          const activeZone = findZoneById(zones, next.zoneId)
          if (activeZone && !next.streaming) {
            const head = tr.selection.head
            if (positionStrictlyInsideZoneContent(head, activeZone)) {
              next = { ...next, userPlacedCaretInZone: true }
            }
          }
        }

        if (tr.docChanged) {
          const hadLocalZoneBeforeChange = findZoneById(value.zones, value.zoneId) !== null
          const zones = collectAIZones(tr.doc)
          const mappedFrom = next.from !== null ? tr.mapping.map(next.from, 1) : null
          const mappedTo = next.to !== null ? tr.mapping.map(next.to, -1) : null
          const mappedOriginalFrom =
            next.originalFrom !== null ? tr.mapping.map(next.originalFrom) : null
          const mappedOriginalSelectionFrom =
            next.originalSelectionFrom !== null ? tr.mapping.map(next.originalSelectionFrom) : null
          const mappedOriginalSelectionTo =
            next.originalSelectionTo !== null ? tr.mapping.map(next.originalSelectionTo) : null
          const localZone = findZoneById(zones, next.zoneId)

          next = {
            ...next,
            zones,
            from: localZone ? localZone.nodeFrom : mappedFrom,
            to: localZone ? localZone.nodeTo : mappedTo,
            originalFrom: mappedOriginalFrom,
            originalSelectionFrom: mappedOriginalSelectionFrom,
            originalSelectionTo: mappedOriginalSelectionTo,
            streaming: localZone ? localZone.streaming : next.streaming,
          }

          if (next.active && next.zoneId && !localZone && hadLocalZoneBeforeChange) {
            next = createInactiveState(zones)
          }
        }

        return isAIWriterStateEqual(value, next) ? value : next
      },
    },
    appendTransaction(transactions, oldState, newState) {
      const docChanged = transactions.some((transaction) => transaction.docChanged)
      const hadStreamingStop = transactions.some(
        (transaction) => getWriterMeta(transaction)?.type === 'streaming_stop'
      )
      if (!docChanged && !hadStreamingStop) {
        return null
      }

      const tr = newState.tr
      let changed = false

      if (docChanged) {
        const pluginState = aiWriterPluginKey.getState(newState)
        const activeZoneId = pluginState?.zoneId ?? null
        const invalidPositions = collectInvalidAIZoneNodePositions(newState.doc, activeZoneId)
        const zoneType = newState.schema.nodes.ai_zone

        if (zoneType) {
          for (const position of invalidPositions) {
            const mappedFrom = tr.mapping.map(position, -1)
            const node = tr.doc.nodeAt(mappedFrom)
            if (!node || node.type !== zoneType) {
              continue
            }

            tr.replaceWith(mappedFrom, mappedFrom + node.nodeSize, node.content)
            changed = true
          }
        }
      }

      const wasRemoteYjs = transactions.some(
        (transaction) =>
          transaction.docChanged &&
          (transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)
            ?.isChangeOrigin === true
      )
      const absoluteSnapshot = wasRemoteYjs
        ? consumeAbsoluteSelectionSnapshotBeforeRemoteTx()
        : null
      if (absoluteSnapshot) {
        const restored = shouldRevertIllegalInsideZoneSelection(
          transactions,
          oldState,
          tr.doc,
          newState.selection.head,
          absoluteSnapshot
        )
        if (restored) {
          tr.setSelection(TextSelection.create(tr.doc, restored.anchor, restored.head))
          changed = true
        }
      }

      if (hadStreamingStop) {
        const pluginState = aiWriterPluginKey.getState(newState)
        const activeZone = pluginState?.zoneId
          ? findZoneById(collectAIZones(tr.doc), pluginState.zoneId)
          : null
        if (activeZone && pluginState && !pluginState.userPlacedCaretInZone) {
          const wasInside = selectionHeadStrictlyInsideZones(
            oldState.selection.head,
            collectAIZones(oldState.doc),
            oldState.doc
          )
          const nowInside = selectionHeadStrictlyInsideZones(
            newState.selection.head,
            [activeZone],
            tr.doc
          )
          if (!wasInside && nowInside) {
            const anchor = mapPositionThroughTransactions(oldState.selection.anchor, transactions)
            const head = mapPositionThroughTransactions(oldState.selection.head, transactions)
            const docSize = tr.doc.content.size
            tr.setSelection(
              TextSelection.create(
                tr.doc,
                Math.max(0, Math.min(anchor, docSize)),
                Math.max(0, Math.min(head, docSize))
              )
            )
            changed = true
          }
        }
      }

      if (docChanged) {
        const pluginState = aiWriterPluginKey.getState(newState)
        if (!pluginState?.active) {
          const addedPendingZones = findAddedPendingReviewZones(tr.doc, oldState.doc)
          if (addedPendingZones.length === 1) {
            const zone = addedPendingZones[0]!
            tr.setMeta(aiWriterPluginKey, {
              type: 'resume_review',
              zoneId: zone.id,
              sessionId: zone.sessionId,
            })
            changed = true
          }
        }
      }

      if (!changed) {
        return null
      }

      tr.setMeta('addToHistory', false)
      tr.setMeta(AI_ZONE_ALLOWED_META, true)
      return tr
    },
    props: {
      handleTextInput(view, from, to) {
        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState) {
          return false
        }

        const ranges = protectedRanges(pluginState, view.state.doc)
        if (ranges.length === 0) return false

        if (from === to && ranges.some((range) => from > range.from && from < range.to)) {
          return true
        }

        if (ranges.some((range) => from < range.to && to > range.from)) {
          return true
        }

        return false
      },
      handlePaste(view) {
        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState) {
          return false
        }

        const ranges = protectedRanges(pluginState, view.state.doc)
        if (ranges.length === 0) return false

        const selection = view.state.selection

        if (ranges.some((range) => selection.from < range.to && selection.to > range.from)) {
          return true
        }

        return false
      },
      handleKeyDown(view, event) {
        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState) return false

        const pendingReviewZone = resolvePendingReviewZone(view)
        const canUseReviewShortcuts =
          pendingReviewZone !== null || (pluginState.active && pluginState.zoneId !== null)

        if (canUseReviewShortcuts) {
          const zoneId = pendingReviewZone?.id ?? pluginState.zoneId ?? undefined

          if (event.key === 'Tab') {
            event.preventDefault()
            handlers.onAccept(zoneId)
            return true
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            handlers.onReject(zoneId)
            return true
          }
        }

        const ranges = protectedRanges(pluginState, view.state.doc)
        if (ranges.length === 0) return false

        const selection = view.state.selection
        const isEditKey =
          event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter'

        if (!isEditKey) {
          return false
        }

        if (
          !selection.empty &&
          ranges.some((range) => selection.from < range.to && selection.to > range.from)
        ) {
          event.preventDefault()
          return true
        }

        if (
          event.key === 'Backspace' &&
          selection.empty &&
          ranges.some((range) => selection.from > range.from && selection.from < range.to)
        ) {
          event.preventDefault()
          return true
        }

        if (
          event.key === 'Delete' &&
          selection.empty &&
          ranges.some((range) => selection.from >= range.from && selection.from < range.to)
        ) {
          event.preventDefault()
          return true
        }

        if (
          event.key === 'Enter' &&
          selection.empty &&
          ranges.some((range) => selection.from > range.from && selection.from < range.to)
        ) {
          event.preventDefault()
          return true
        }

        return false
      },
    },
  })
}

if (import.meta.hot) {
  import.meta.hot.accept()
}
