import type { EditorView } from 'prosemirror-view'

type EditorViewListener = () => void

const viewListeners = new Map<EditorView, Set<EditorViewListener>>()

/**
 * Broadcasts that the editor view has applied a change that can affect overlay
 * geometry or remote presence placement.
 */
export function emitEditorViewChange(view: EditorView): void {
  viewListeners.get(view)?.forEach((listener) => listener())
}

/**
 * Registers a listener that is notified whenever the editor view's rendered
 * state changes in a way overlays should remeasure.
 */
export function subscribeEditorView(view: EditorView, listener: EditorViewListener): () => void {
  if (!viewListeners.has(view)) {
    viewListeners.set(view, new Set())
  }

  const listeners = viewListeners.get(view)!
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      viewListeners.delete(view)
    }
  }
}
