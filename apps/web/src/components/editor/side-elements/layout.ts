import type { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { COLLISION_PADDING } from '../inline/utils'

export const EDITOR_SIDE_GUTTER_OFFSET = 14
export const EDITOR_NOTE_CARD_WIDTH = 220
export const BLOCK_HANDLE_WIDTH = 28
export const BLOCK_HANDLE_BUTTON_HEIGHT = 20

export interface BlockHandleLayout {
  left: number
  top: number
  height: number
}

export function getEditorContentRect(view: EditorView): DOMRect {
  return view.dom.getBoundingClientRect()
}

export interface BlockHoverZone {
  left: number
  top: number
  right: number
  bottom: number
}

/** Hover zone spanning the page main column (full gutter width on desktop). */
export function getBlockHoverZoneRect(view: EditorView, hoverRootRect: DOMRect): BlockHoverZone {
  const editorRect = view.dom.getBoundingClientRect()
  return {
    left: hoverRootRect.left,
    right: hoverRootRect.right,
    top: Math.min(hoverRootRect.top, editorRect.top),
    bottom: Math.max(hoverRootRect.bottom, editorRect.bottom),
  }
}

export function isPointerInBlockHoverZone(
  view: EditorView,
  hoverRootRect: DOMRect,
  clientX: number,
  clientY: number
): boolean {
  const zone = getBlockHoverZoneRect(view, hoverRootRect)
  return (
    clientX >= zone.left && clientX <= zone.right && clientY >= zone.top && clientY <= zone.bottom
  )
}

/**
 * Positions block handles on the first line of a block (not the block box top),
 * which avoids misalignment from line-height half-leading and block margins.
 */
export function computeBlockHandleLayout(
  view: EditorView,
  containerRect: DOMRect,
  block: { pos: number; node: PMNode; dom: HTMLElement }
): BlockHandleLayout {
  const editorRect = view.dom.getBoundingClientRect()
  const left = computeLeftGutterContainerX(editorRect, containerRect, BLOCK_HANDLE_WIDTH)

  if (block.node.isAtom) {
    const blockRect = block.dom.getBoundingClientRect()
    return {
      left,
      top: blockRect.top - containerRect.top - (BLOCK_HANDLE_BUTTON_HEIGHT - blockRect.height) / 2,
      height: BLOCK_HANDLE_BUTTON_HEIGHT,
    }
  }

  // List and quote containers start above their first editable line. Descend
  // through their first child so gutter controls align with the first marker /
  // text line rather than the container's top margin.
  let anchorNode = block.node
  let anchorPos = block.pos
  while (!anchorNode.isTextblock && anchorNode.firstChild) {
    anchorNode = anchorNode.firstChild
    anchorPos += 1
  }
  const contentPos = Math.min(anchorPos + 1, view.state.doc.content.size)
  try {
    const coords = view.coordsAtPos(contentPos)
    const lineHeight = Math.max(1, coords.bottom - coords.top)
    const height = Math.max(BLOCK_HANDLE_BUTTON_HEIGHT, Math.min(lineHeight, 28))
    const top = coords.top - containerRect.top + (lineHeight - height) / 2
    return { left, top, height }
  } catch {
    const blockRect = block.dom.getBoundingClientRect()
    return {
      left,
      top: blockRect.top - containerRect.top,
      height: Math.max(blockRect.height, BLOCK_HANDLE_BUTTON_HEIGHT),
    }
  }
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

export function computeRightGutterContainerX(
  editorRect: DOMRect,
  containerRect: DOMRect,
  offset: number = EDITOR_SIDE_GUTTER_OFFSET
): number {
  return editorRect.right - containerRect.left + offset
}

export interface StackableSideElement {
  id: string
  desiredTop: number
  height: number
}

export function stackSideElements(
  items: StackableSideElement[],
  gap: number = 8
): Map<string, number> {
  const sorted = [...items].sort((left, right) => left.desiredTop - right.desiredTop)
  const positions = new Map<string, number>()
  let cursor = Number.NEGATIVE_INFINITY

  for (const item of sorted) {
    const top = Math.max(
      item.desiredTop,
      cursor === Number.NEGATIVE_INFINITY ? item.desiredTop : cursor + gap
    )
    positions.set(item.id, top)
    cursor = top + item.height
  }

  return positions
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
