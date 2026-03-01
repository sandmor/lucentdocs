/**
 * Tiny external store for ProseMirror AI plugin state.
 * Kept in a separate file to satisfy react-refresh (only-export-components).
 */
import type { EditorView } from 'prosemirror-view'
import { aiWriterPluginKey, type AIWriterState } from './writer-plugin'

type AIStateListener = (state: AIWriterState | null) => void
const aiStateListeners = new Map<EditorView, Set<AIStateListener>>()

export function emitAIStateChange(view: EditorView) {
  const state = aiWriterPluginKey.getState(view.state) ?? null
  aiStateListeners.get(view)?.forEach((fn) => fn(state))
}

export function subscribeAIState(view: EditorView, cb: AIStateListener) {
  if (!aiStateListeners.has(view)) aiStateListeners.set(view, new Set())
  const listeners = aiStateListeners.get(view)!
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) {
      aiStateListeners.delete(view)
    }
  }
}

export function getAIStateSnapshot(view: EditorView): AIWriterState | null {
  return aiWriterPluginKey.getState(view.state) ?? null
}
