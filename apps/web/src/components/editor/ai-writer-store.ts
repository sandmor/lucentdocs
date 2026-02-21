/**
 * Tiny external store so imperative streaming code can push AI choices into React.
 * Kept in a separate file to satisfy react-refresh (only-export-components).
 */
import type { EditorView } from 'prosemirror-view'
import { aiWriterPluginKey, type AIWriterState } from './ai-writer-plugin'

/* ------------------------------------------------------------------ */
/*  Choices store                                                     */
/* ------------------------------------------------------------------ */

type ChoicesListener = (choices: string[] | null) => void
const choicesListeners = new Map<EditorView, Set<ChoicesListener>>()
const choicesStore = new WeakMap<EditorView, string[] | null>()

export function setAIChoices(view: EditorView, choices: string[] | null) {
  choicesStore.set(view, choices)
  choicesListeners.get(view)?.forEach((fn) => fn(choices))
}

export function subscribeChoices(view: EditorView, cb: ChoicesListener) {
  if (!choicesListeners.has(view)) choicesListeners.set(view, new Set())
  const listeners = choicesListeners.get(view)!
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) {
      choicesListeners.delete(view)
    }
  }
}

export function getChoicesSnapshot(view: EditorView): string[] | null {
  return choicesStore.get(view) ?? null
}

/* ------------------------------------------------------------------ */
/*  ProseMirror AI state store                                        */
/* ------------------------------------------------------------------ */

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
