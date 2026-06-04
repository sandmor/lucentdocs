import { create } from 'zustand'
import type { EditorView } from 'prosemirror-view'
import type { ConnectionStatus } from '@/lib/yjs-provider'
import type { SelectionRange } from '@/components/editor/selection/types'
import type { InlineZoneSession } from '@lucentdocs/shared'
import {
  areInlineSessionPreviewsEqual,
  type InlineSessionPreview,
} from '@/components/editor/inline/inline-session-preview'

export interface InlineSessionStreamMeta {
  generating: boolean
  generationId: string | null
}

interface EditorStore {
  // Editor view reference (stable, doesn't cause re-renders on its own)
  editorView: EditorView | null
  setEditorView: (view: EditorView | null) => void

  // Connection status
  connectionStatus: ConnectionStatus
  setConnectionStatus: (status: ConnectionStatus) => void

  // Whether AI is generating/streaming
  isGenerating: boolean
  setIsGenerating: (generating: boolean) => void

  // Editor selection (for chat context)
  editorSelection: { from: number; to: number } | null
  setEditorSelection: (selection: { from: number; to: number } | null) => void

  // Selection range (for inline AI controls)
  selectionRange: SelectionRange | null
  setSelectionRange: (range: SelectionRange | null) => void

  // Whether editor is focused
  isEditorFocused: boolean
  setIsEditorFocused: (focused: boolean) => void

  // Inline AI sessions
  inlineSessionsById: Record<string, InlineZoneSession>
  setSessionById: (sessionId: string, session: InlineZoneSession | null) => void
  setSessions: (
    updater: (prev: Record<string, InlineZoneSession>) => Record<string, InlineZoneSession>
  ) => void

  inlineSessionPreviewById: Record<string, InlineSessionPreview | null>
  setSessionPreviewById: (sessionId: string, preview: InlineSessionPreview | null) => void

  inlineSessionStreamMetaById: Record<string, InlineSessionStreamMeta>
  setSessionStreamMetaById: (sessionId: string, meta: InlineSessionStreamMeta | null) => void

  // Editor session key (for forcing remount on restore)
  editorSessionKey: number
  bumpEditorSessionKey: () => void
}

export const useEditorStore = create<EditorStore>((set) => ({
  editorView: null,
  setEditorView: (view) => set({ editorView: view }),

  connectionStatus: 'connecting',
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  isGenerating: false,
  setIsGenerating: (generating) => set({ isGenerating: generating }),

  editorSelection: null,
  setEditorSelection: (selection) => set({ editorSelection: selection }),

  selectionRange: null,
  setSelectionRange: (range) => set({ selectionRange: range }),

  isEditorFocused: false,
  setIsEditorFocused: (focused) => set({ isEditorFocused: focused }),

  inlineSessionsById: {},
  setSessionById: (sessionId, session) =>
    set((state) => {
      const current = state.inlineSessionsById[sessionId]
      if (session === null) {
        if (current === undefined) return state
        const next = { ...state.inlineSessionsById }
        delete next[sessionId]
        return { inlineSessionsById: next }
      }

      if (current === session) return state
      return {
        inlineSessionsById: {
          ...state.inlineSessionsById,
          [sessionId]: session,
        },
      }
    }),
  setSessions: (updater) =>
    set((state) => ({ inlineSessionsById: updater(state.inlineSessionsById) })),

  inlineSessionPreviewById: {},
  setSessionPreviewById: (sessionId, preview) =>
    set((state) => {
      const current = state.inlineSessionPreviewById[sessionId] ?? null
      if (preview === null) {
        if (current === null) return state
        const next = { ...state.inlineSessionPreviewById }
        delete next[sessionId]
        return { inlineSessionPreviewById: next }
      }
      if (areInlineSessionPreviewsEqual(current, preview)) return state
      return {
        inlineSessionPreviewById: {
          ...state.inlineSessionPreviewById,
          [sessionId]: preview,
        },
      }
    }),

  inlineSessionStreamMetaById: {},
  setSessionStreamMetaById: (sessionId, meta) =>
    set((state) => {
      if (meta === null) {
        if (state.inlineSessionStreamMetaById[sessionId] === undefined) return state
        const next = { ...state.inlineSessionStreamMetaById }
        delete next[sessionId]
        return { inlineSessionStreamMetaById: next }
      }
      const current = state.inlineSessionStreamMetaById[sessionId]
      if (current?.generating === meta.generating && current?.generationId === meta.generationId) {
        return state
      }
      return {
        inlineSessionStreamMetaById: {
          ...state.inlineSessionStreamMetaById,
          [sessionId]: meta,
        },
      }
    }),

  editorSessionKey: 0,
  bumpEditorSessionKey: () => set((state) => ({ editorSessionKey: state.editorSessionKey + 1 })),
}))
