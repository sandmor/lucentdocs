import type { EditorView } from 'prosemirror-view'

export function hasActiveDomSelection(view: EditorView): boolean {
  if (typeof window === 'undefined') return false

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false
  }

  const range = selection.getRangeAt(0)
  return view.dom.contains(range.commonAncestorContainer)
}
