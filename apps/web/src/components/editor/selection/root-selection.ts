import type { EditorView } from 'prosemirror-view'

/**
 * Returns the active selection from the editor's owning document or shadow root.
 *
 * ProseMirror stores the resolved root on the view instance, which is required
 * for shadow-DOM mounted editors. Falling back to window keeps normal documents
 * working without special handling.
 */
export function getViewRootSelection(view: EditorView): Selection | null {
  if (typeof window === 'undefined') return null

  const root = (view as unknown as { _root?: { getSelection?: () => Selection | null } })._root
  return root?.getSelection?.() ?? window.getSelection()
}
