import type { EditorView } from 'prosemirror-view'
import { getViewRootSelection } from './root-selection'

export interface DomSelectionRange {
  anchor: number
  head: number
  from: number
  to: number
  empty: boolean
}

export function hasActiveDomSelection(view: EditorView): boolean {
  const selection = getSelectionRangeInView(view)
  if (!selection) {
    return false
  }

  return !selection.empty
}

export function getSelectionRangeInView(view: EditorView): DomSelectionRange | null {
  const selection = getViewRootSelection(view)
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !selection.focusNode) {
    return null
  }

  if (!view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) {
    return null
  }

  try {
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset, 1)
    const head = view.posAtDOM(selection.focusNode, selection.focusOffset, -1)

    return {
      anchor,
      head,
      from: Math.min(anchor, head),
      to: Math.max(anchor, head),
      empty: anchor === head,
    }
  } catch {
    return null
  }
}
