import type { EditorView } from 'prosemirror-view'
import { yUndoPluginKey } from 'y-prosemirror'

export function stopYjsUndoCapture(view: EditorView): void {
  const undoState = yUndoPluginKey.getState(view.state) as
    | { undoManager?: { stopCapturing: () => void } }
    | undefined
  undoState?.undoManager?.stopCapturing()

  const tr = view.state.tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}
