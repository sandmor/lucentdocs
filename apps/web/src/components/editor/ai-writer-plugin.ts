import { type Node as ProseMirrorNode, type Slice } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

export type AIMode = 'replace' | 'insert' | 'choices'

export interface AIZone {
  id: string
  from: number
  to: number
  mode: AIMode
  streaming: boolean
  choices: string[]
  deletedSlice: string | null
}

export interface AIWriterState {
  active: boolean
  zoneId: string | null
  from: number | null
  to: number | null
  streaming: boolean
  stuck: boolean
  deletedSlice: Slice | null
  deletedFrom: number | null
  mode: AIMode | null
  insertIndex: number | null
  originalSelectionFrom: number | null
  originalSelectionTo: number | null
  zones: AIZone[]
}

export interface AIWriterActionHandlers {
  onAccept: () => void
  onReject: () => void
  onCancelAI: (view: EditorView) => void
}

export const aiWriterPluginKey = new PluginKey<AIWriterState>('ai_writer')

function parseMode(value: unknown): AIMode {
  if (value === 'replace' || value === 'insert' || value === 'choices') return value
  return 'insert'
}

function parseChoices(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string')
  }

  if (typeof value === 'string' && value.length > 0) {
    try {
      const parsed = JSON.parse(value) as unknown
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === 'string')
      }
    } catch {
      return []
    }
  }

  return []
}

function readZoneMarkAttrs(mark: unknown): AIZone | null {
  if (typeof mark !== 'object' || mark === null || Array.isArray(mark)) {
    return null
  }

  const attrs = mark as Record<string, unknown>
  const id = attrs.id
  if (typeof id !== 'string' || id.length === 0) {
    return null
  }

  const mode = parseMode(attrs.mode)
  const streaming = attrs.streaming === true
  const choices = parseChoices(attrs.choices)
  const deletedSlice =
    typeof attrs.deletedSlice === 'string' && attrs.deletedSlice.length > 0
      ? attrs.deletedSlice
      : null

  return {
    id,
    from: 0,
    to: 0,
    mode,
    streaming,
    choices,
    deletedSlice,
  }
}

function collectAIZones(doc: ProseMirrorNode): AIZone[] {
  const markType = doc.type.schema.marks.ai_zone
  if (!markType) return []

  const byId = new Map<string, AIZone>()

  doc.descendants((node, pos) => {
    if (!node.isText) return true

    for (const mark of node.marks) {
      if (mark.type !== markType) continue

      const parsed = readZoneMarkAttrs(mark.attrs)
      if (!parsed) continue

      const from = pos
      const to = pos + node.nodeSize
      const current = byId.get(parsed.id)

      if (!current) {
        byId.set(parsed.id, {
          ...parsed,
          from,
          to,
        })
        continue
      }

      current.from = Math.min(current.from, from)
      current.to = Math.max(current.to, to)
      current.streaming = current.streaming || parsed.streaming

      if (current.mode !== parsed.mode) {
        current.mode = parsed.mode
      }

      if (parsed.choices.length > 0) {
        current.choices = parsed.choices
      }

      if (!current.deletedSlice && parsed.deletedSlice) {
        current.deletedSlice = parsed.deletedSlice
      }
    }

    return true
  })

  return [...byId.values()]
    .filter((zone) => zone.from < zone.to)
    .sort((left, right) => left.from - right.from)
}

function createInactiveState(zones: AIZone[] = []): AIWriterState {
  return {
    active: false,
    zoneId: null,
    from: null,
    to: null,
    streaming: false,
    stuck: false,
    deletedSlice: null,
    deletedFrom: null,
    mode: null,
    insertIndex: null,
    originalSelectionFrom: null,
    originalSelectionTo: null,
    zones,
  }
}

function protectedRanges(state: AIWriterState): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []

  for (const zone of state.zones) {
    if (zone.from < zone.to) {
      ranges.push({ from: zone.from, to: zone.to })
    }
  }

  if (state.active && state.from !== null && state.to !== null && state.from < state.to) {
    ranges.push({ from: state.from, to: state.to })
  }

  return ranges
}

function findZoneById(zones: AIZone[], zoneId: string | null): AIZone | null {
  if (!zoneId) return null
  return zones.find((zone) => zone.id === zoneId) ?? null
}

function localZoneBounds(state: AIWriterState): { from: number | null; to: number | null } {
  const localZone = findZoneById(state.zones, state.zoneId)
  if (localZone) {
    return { from: localZone.from, to: localZone.to }
  }

  return { from: state.from, to: state.to }
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
            from: meta.pos,
            to: meta.pos,
            streaming: true,
            stuck: false,
            deletedSlice: meta.deletedSlice ?? null,
            deletedFrom: meta.deletedSlice ? meta.pos : null,
            mode: null,
            insertIndex: null,
            originalSelectionFrom: meta.selectionFrom ?? meta.pos,
            originalSelectionTo: meta.selectionTo ?? meta.pos,
          }
        }

        if (meta?.type === 'mode_detected') {
          next = {
            ...next,
            mode: parseMode(meta.mode),
            insertIndex: meta.insertIndex ?? null,
          }
        }

        if (meta?.type === 'zone_start') {
          next = {
            ...next,
            from: meta.pos,
            to: meta.pos,
            deletedSlice: meta.deletedSlice ?? next.deletedSlice,
            deletedFrom: meta.deletedFrom ?? next.deletedFrom,
          }
        }

        if (meta?.type === 'zone_set') {
          next = {
            ...next,
            from: meta.from,
            to: meta.to,
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

        if (meta?.type === 'stop') {
          next = createInactiveState(next.zones)
        }

        if (meta?.type === 'accept') {
          next = createInactiveState(next.zones)
        }

        if (meta?.type === 'reject') {
          next = createInactiveState(next.zones)
        }

        if (tr.docChanged) {
          const zones = collectAIZones(tr.doc)
          const mappedFrom = next.from !== null ? tr.mapping.map(next.from, 1) : null
          const mappedTo = next.to !== null ? tr.mapping.map(next.to, -1) : null
          const mappedDeletedFrom =
            next.deletedFrom !== null ? tr.mapping.map(next.deletedFrom) : null
          const mappedOriginalSelectionFrom =
            next.originalSelectionFrom !== null ? tr.mapping.map(next.originalSelectionFrom) : null
          const mappedOriginalSelectionTo =
            next.originalSelectionTo !== null ? tr.mapping.map(next.originalSelectionTo) : null
          const localZone = findZoneById(zones, next.zoneId)

          next = {
            ...next,
            zones,
            from: localZone ? localZone.from : mappedFrom,
            to: localZone ? localZone.to : mappedTo,
            deletedFrom: mappedDeletedFrom,
            originalSelectionFrom: mappedOriginalSelectionFrom,
            originalSelectionTo: mappedOriginalSelectionTo,
            mode: localZone ? localZone.mode : next.mode,
            streaming: localZone ? localZone.streaming : next.streaming,
          }

          if (
            next.active &&
            next.zoneId &&
            !localZone &&
            (next.streaming === false || meta?.type === 'accept' || meta?.type === 'reject')
          ) {
            next = createInactiveState(zones)
          }
        }

        return next
      },
    },
    props: {
      handleTextInput(view, from, to) {
        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState) {
          return false
        }

        const ranges = protectedRanges(pluginState)
        if (ranges.length === 0) return false

        const localBounds = localZoneBounds(pluginState)

        if (from === to && ranges.some((range) => from > range.from && from < range.to)) {
          return true
        }

        if (ranges.some((range) => from < range.to && to > range.from)) {
          return true
        }

        if (
          pluginState.active &&
          pluginState.streaming &&
          localBounds.from !== null &&
          localBounds.to !== null &&
          from === localBounds.to &&
          from >= localBounds.from
        ) {
          handlers.onCancelAI(view)
          return false
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
        const localBounds = localZoneBounds(pluginState)

        if (ranges.some((range) => selection.from < range.to && selection.to > range.from)) {
          return true
        }

        if (
          pluginState.active &&
          pluginState.streaming &&
          localBounds.from !== null &&
          localBounds.to !== null &&
          selection.from === localBounds.to &&
          selection.to === localBounds.to
        ) {
          handlers.onCancelAI(view)
          return false
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

          if ((event.key === 'z' || event.key === 'y') && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            handlers.onReject()
            return true
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
