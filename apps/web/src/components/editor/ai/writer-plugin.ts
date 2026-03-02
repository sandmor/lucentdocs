import { type Node as ProseMirrorNode, type Slice } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { hasMeaningfulGap, parseZoneNodeAttrs } from '@plotline/shared'

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
  zones: AIZone[]
}

export interface AIWriterActionHandlers {
  onAccept: () => void
  onReject: () => void
  onCancelAI: (view: EditorView, options?: { preserveDoc?: boolean }) => void
}

export const aiWriterPluginKey = new PluginKey<AIWriterState>('ai_writer')

function collectInvalidAIZoneNodePositions(doc: ProseMirrorNode): number[] {
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

    const previousNodeTo = lastNodeToById.get(parsed.id)
    if (previousNodeTo !== undefined && hasMeaningfulGap(doc, previousNodeTo, pos)) {
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

    if (hasMeaningfulGap(doc, existing.nodeTo, segment.nodeFrom)) {
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
    zones,
  }
}

function protectedRanges(state: AIWriterState): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []

  for (const zone of state.zones) {
    if (zone.nodeFrom < zone.nodeTo) {
      ranges.push({ from: zone.nodeFrom, to: zone.nodeTo })
    }
  }

  return ranges
}

function findZoneById(zones: AIZone[], zoneId: string | null): AIZone | null {
  if (!zoneId) return null
  return zones.find((zone) => zone.id === zoneId) ?? null
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

export function createAIWriterPlugin(handlers: AIWriterActionHandlers): Plugin {
  return new Plugin({
    key: aiWriterPluginKey,
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

        if (meta?.type === 'stop' || meta?.type === 'accept' || meta?.type === 'reject') {
          next = createInactiveState(next.zones)
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

        return next
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null
      }

      const invalidPositions = collectInvalidAIZoneNodePositions(newState.doc)
      if (invalidPositions.length === 0) {
        return null
      }

      const zoneType = newState.schema.nodes.ai_zone
      if (!zoneType) {
        return null
      }

      const tr = newState.tr
      for (const position of invalidPositions) {
        const mappedFrom = tr.mapping.map(position, -1)
        const node = tr.doc.nodeAt(mappedFrom)
        if (!node || node.type !== zoneType) {
          continue
        }

        tr.replaceWith(mappedFrom, mappedFrom + node.nodeSize, node.content)
      }

      if (!tr.docChanged) {
        return null
      }

      tr.setMeta('addToHistory', false)
      return tr
    },
    props: {
      handleTextInput(view, from, to) {
        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState) {
          return false
        }

        const ranges = protectedRanges(pluginState)
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

        const ranges = protectedRanges(pluginState)
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

        if (pluginState.active) {
          if (event.key === 'Tab') {
            event.preventDefault()
            handlers.onAccept()
            return true
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            handlers.onReject()
            return true
          }

          if (
            ((event.key === 'z' || event.key === 'Z') && (event.metaKey || event.ctrlKey)) ||
            ((event.key === 'y' || event.key === 'Y') && (event.metaKey || event.ctrlKey))
          ) {
            handlers.onCancelAI(view, { preserveDoc: true })
            return false
          }
        }

        const ranges = protectedRanges(pluginState)
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
          ranges.some((range) => selection.from > range.from && selection.from <= range.to)
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
