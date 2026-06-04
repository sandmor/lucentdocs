import type { EditorView } from 'prosemirror-view'
import { COLLISION_PADDING } from '../inline/utils'

export const EDITOR_SIDE_GUTTER_OFFSET = 14

export function getEditorContentRect(view: EditorView): DOMRect {
  return view.dom.getBoundingClientRect()
}

/**
 * Viewport X for a fixed side element whose right edge sits `offset` px left of the editor.
 */
export function computeLeftGutterViewportX(
  editorRect: DOMRect,
  elementWidth: number,
  offset: number = EDITOR_SIDE_GUTTER_OFFSET
): number {
  return editorRect.left - offset - elementWidth
}

/**
 * Container-relative X for a side element whose right edge sits `offset` px left of the editor.
 */
export function computeLeftGutterContainerX(
  editorRect: DOMRect,
  containerRect: DOMRect,
  elementWidth: number,
  offset: number = EDITOR_SIDE_GUTTER_OFFSET
): number {
  return editorRect.left - containerRect.left - offset - elementWidth
}

export function clampSideElementToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  padding: number = COLLISION_PADDING
): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y }

  const minX = padding
  const minY = padding
  const maxX = Math.max(minX, window.innerWidth - width - padding)
  const maxY = Math.max(minY, window.innerHeight - height - padding)

  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  }
}

export function getRangeBandRect(view: EditorView, from: number, to: number): DOMRect | null {
  try {
    const range = document.createRange()
    const fromDOM = view.domAtPos(from)
    const toDOM = view.domAtPos(to)
    range.setStart(fromDOM.node, fromDOM.offset)
    range.setEnd(toDOM.node, toDOM.offset)

    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0
    )
    range.detach()

    if (rects.length > 0) {
      const top = Math.min(...rects.map((rect) => rect.top))
      const bottom = Math.max(...rects.map((rect) => rect.bottom))
      return new DOMRect(0, top, 1, Math.max(1, bottom - top))
    }
  } catch {
    // Fall through to coordinate-based placement.
  }

  try {
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to)
    const top = Math.min(start.top, end.top)
    const bottom = Math.max(start.bottom, end.bottom)
    return new DOMRect(0, top, 1, Math.max(1, bottom - top))
  } catch {
    return null
  }
}
