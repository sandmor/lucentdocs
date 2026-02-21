import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'

export type AIMode = 'replace' | 'insert' | 'choices'

export interface AIWriterState {
  active: boolean
  from: number | null
  to: number | null
  streaming: boolean
  stuck: boolean
  deletedSlice: import('prosemirror-model').Slice | null
  deletedFrom: number | null
  mode: AIMode | null
  insertIndex: number | null
  originalSelectionFrom: number | null
  originalSelectionTo: number | null
}

export interface AIWriterDraftRange {
  from: number
  to: number
}

export interface AIWriterActionHandlers {
  onAccept: () => void
  onReject: () => void
  onCancelAI: (view: EditorView) => void
}

export const aiWriterPluginKey = new PluginKey<AIWriterState>('ai_writer')

function createInactiveState(): AIWriterState {
  return {
    active: false,
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
  }
}

function clampDraftRange(range: AIWriterDraftRange, docSize: number): AIWriterDraftRange | null {
  const from = Math.max(0, Math.min(range.from, docSize))
  const to = Math.max(0, Math.min(range.to, docSize))

  if (from >= to) {
    return null
  }

  return { from, to }
}

export function getAIDraftRange(view: EditorView): AIWriterDraftRange | null {
  const state = aiWriterPluginKey.getState(view.state)
  if (!state?.active || state.from === null || state.to === null || state.from >= state.to) {
    return null
  }

  return { from: state.from, to: state.to }
}

export function createAIWriterPlugin(
  initialDraft: AIWriterDraftRange | null = null,
  handlers: AIWriterActionHandlers
): Plugin {
  const initialRange = initialDraft ?? null

  return new Plugin({
    key: aiWriterPluginKey,
    state: {
      init(_config, instanceState): AIWriterState {
        if (!initialRange) {
          return createInactiveState()
        }

        const clamped = clampDraftRange(initialRange, instanceState.doc.content.size)
        if (!clamped) {
          return createInactiveState()
        }

        return {
          active: true,
          from: clamped.from,
          to: clamped.to,
          streaming: false,
          stuck: false,
          deletedSlice: null,
          deletedFrom: null,
          mode: null,
          insertIndex: null,
          originalSelectionFrom: null,
          originalSelectionTo: null,
        }
      },
      apply(tr, value): AIWriterState {
        const meta = tr.getMeta(aiWriterPluginKey)

        if (meta?.type === 'start') {
          return {
            active: true,
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
          return {
            ...value,
            mode: meta.mode,
            insertIndex: meta.insertIndex ?? null,
          }
        }

        if (meta?.type === 'zone_start') {
          return {
            ...value,
            from: meta.pos,
            to: meta.pos,
            deletedSlice: meta.deletedSlice ?? value.deletedSlice,
            deletedFrom: meta.deletedFrom ?? value.deletedFrom,
          }
        }

        if (meta?.type === 'zone_set') {
          return {
            ...value,
            from: meta.from,
            to: meta.to,
          }
        }

        if (meta?.type === 'streaming_stop') {
          return { ...value, streaming: false, stuck: false }
        }

        if (meta?.type === 'stuck_start') {
          return { ...value, stuck: true }
        }

        if (meta?.type === 'stuck_stop') {
          return { ...value, stuck: false }
        }

        if (meta?.type === 'stop') {
          return createInactiveState()
        }

        if (meta?.type === 'accept') {
          return createInactiveState()
        }

        if (meta?.type === 'reject') {
          return createInactiveState()
        }

        if (value.active && tr.docChanged && value.from !== null && value.to !== null) {
          if (meta?.type === 'revert_for_accept') {
            return value
          }

          const isChunkInsert = meta?.type === 'chunk'
          const from = tr.mapping.map(value.from, isChunkInsert ? -1 : 1)
          const to = tr.mapping.map(value.to, isChunkInsert ? 1 : -1)
          const deletedFrom = value.deletedFrom !== null ? tr.mapping.map(value.deletedFrom) : null
          const originalSelectionFrom = value.originalSelectionFrom !== null ? tr.mapping.map(value.originalSelectionFrom) : null
          const originalSelectionTo = value.originalSelectionTo !== null ? tr.mapping.map(value.originalSelectionTo) : null

          return {
            ...value,
            from: Math.min(from, to),
            to: Math.max(from, to),
            deletedFrom,
            originalSelectionFrom,
            originalSelectionTo,
          }
        }

        return value
      },
    },
    props: {
      decorations(state) {
        const pluginState = aiWriterPluginKey.getState(state)
        if (!pluginState?.active || pluginState.from === null || pluginState.to === null) {
          return null
        }

        if (pluginState.from === pluginState.to) {
          return null
        }

        const decorations: Decoration[] = []

        decorations.push(
          Decoration.inline(
            pluginState.from,
            pluginState.to,
            {
              class: 'ai-generating-text',
            },
            {
              inclusiveStart: false,
              inclusiveEnd: false,
            }
          )
        )

        return DecorationSet.create(state.doc, decorations)
      },
      handleTextInput(view, from, to) {
        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState?.active || pluginState.from === null || pluginState.to === null) {
          return false
        }

        const zoneFrom = pluginState.from
        const zoneTo = pluginState.to

        // Strictly block typing within the bubble.
        if (from === to && from > zoneFrom && from < zoneTo) {
          return true
        }

        // Block replacement typing when it overlaps the AI zone.
        if (from < zoneTo && to > zoneFrom) {
          return true
        }

        // If user types at the end of the zone (at 'to'), cancel streaming
        // but keep zone active for accept/reject. User text goes outside zone.
        if (from === zoneTo) {
          handlers.onCancelAI(view)
          return false
        }

        return false
      },
      handlePaste(view, _event, _slice) {
        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState?.active || pluginState.from === null || pluginState.to === null) {
          return false
        }

        const selection = view.state.selection
        const zoneFrom = pluginState.from
        const zoneTo = pluginState.to

        // Block paste when selection overlaps any part of the AI zone
        if (selection.from < zoneTo && selection.to > zoneFrom) {
          return true
        }

        // If pasting at the end of zone, cancel streaming
        if (selection.from === zoneTo && selection.to === zoneTo) {
          handlers.onCancelAI(view)
          return false
        }

        return false
      },
      handleKeyDown(view, event) {
        const pluginState = aiWriterPluginKey.getState(view.state)
        if (!pluginState?.active) return false

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

        if (pluginState.from === null || pluginState.to === null) {
          return false
        }

        const selection = view.state.selection
        const zoneFrom = pluginState.from
        const zoneTo = pluginState.to
        const isEditKey =
          event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter'

        if (!isEditKey) {
          return false
        }

        if (!selection.empty && selection.from < zoneTo && selection.to > zoneFrom) {
          event.preventDefault()
          return true
        }

        if (
          event.key === 'Backspace' &&
          selection.empty &&
          selection.from > zoneFrom &&
          selection.from <= zoneTo
        ) {
          event.preventDefault()
          return true
        }

        if (
          event.key === 'Delete' &&
          selection.empty &&
          selection.from >= zoneFrom &&
          selection.from < zoneTo
        ) {
          event.preventDefault()
          return true
        }

        if (
          event.key === 'Enter' &&
          selection.empty &&
          selection.from > zoneFrom &&
          selection.from < zoneTo
        ) {
          event.preventDefault()
          return true
        }

        return false
      },
    },
  })
}
