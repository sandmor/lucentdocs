import type { MarkType } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { aiWriterPluginKey } from '../ai/writer-plugin'
import type { FormatMarkName } from './types'
import type { SelectionRange } from '../selection/types'
import { parseMarkdownishToSlice } from '../prosemirror/markdownish'
import { replaceZoneContent } from '../ai/writer/zone-marks'

export const COLLISION_PADDING = 8

export function resolveMarkType(view: EditorView, markName: FormatMarkName): MarkType | null {
  return view.state.schema.marks[markName] ?? null
}

export function isMarkActive(view: EditorView, markName: FormatMarkName): boolean {
  const markType = resolveMarkType(view, markName)
  if (!markType) return false

  const { from, to, empty } = view.state.selection
  if (empty) {
    const stored = view.state.storedMarks ?? view.state.selection.$from.marks()
    return stored.some((mark) => mark.type === markType)
  }

  return view.state.doc.rangeHasMark(from, to, markType)
}

export function selectChoice(
  view: EditorView,
  choice: string,
  selectionFrom: number,
  selectionTo: number
): void {
  const docSize = view.state.doc.content.size
  const safeFrom = Math.max(0, Math.min(Math.min(selectionFrom, selectionTo), docSize))
  const safeTo = Math.max(0, Math.min(Math.max(selectionFrom, selectionTo), docSize))
  if (safeFrom >= safeTo) return

  const tr = view.state.tr
  const pluginState = aiWriterPluginKey.getState(view.state)
  const zone =
    pluginState?.zones.find((entry) => safeFrom < entry.nodeTo && safeTo > entry.nodeFrom) ??
    pluginState?.zones.find((entry) => entry.nodeFrom === safeFrom && entry.nodeTo === safeTo) ??
    null

  if (!zone) return

  const $from = view.state.doc.resolve(zone.nodeFrom)
  const $to = view.state.doc.resolve(zone.nodeTo)
  const replacement = parseMarkdownishToSlice(choice, {
    openStart: $from.parent.inlineContent,
    openEnd: $to.parent.inlineContent,
  })

  if (
    replaceZoneContent(view, zone.id, replacement, {
      streaming: false,
      addToHistory: true,
    })
  ) {
    return
  }

  tr.delete(safeFrom, safeTo)
  tr.insertText(choice, safeFrom)
  tr.setMeta('addToHistory', true)
  view.dispatch(tr)
}

export function applyPosition(element: HTMLElement, x: number, y: number): void {
  element.style.left = `${Math.round(x)}px`
  element.style.top = `${Math.round(y)}px`
}

export function getSelectionRect(view: EditorView, selection: SelectionRange): DOMRect {
  try {
    const docSize = view.state.doc.content.size
    const from = Math.max(0, Math.min(selection.from, docSize))
    const to = Math.max(0, Math.min(selection.to, docSize))
    const safeFrom = Math.min(from, to)
    const safeTo = Math.max(from, to)

    const range = document.createRange()
    const startDom = view.domAtPos(safeFrom)
    const endDom = view.domAtPos(safeTo)
    range.setStart(startDom.node, startDom.offset)
    range.setEnd(endDom.node, endDom.offset)

    const rangeRect = range.getBoundingClientRect()
    if (rangeRect.width > 0 || rangeRect.height > 0) {
      return rangeRect
    }

    const start = view.coordsAtPos(safeFrom)
    const end = view.coordsAtPos(safeTo)

    const left = Math.min(start.left, end.left)
    const right = Math.max(start.right, end.right)
    const top = Math.min(start.top, end.top)
    const bottom = Math.max(start.bottom, end.bottom)

    return new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top))
  } catch {
    const fallback = view.dom.getBoundingClientRect()
    return new DOMRect(fallback.left, fallback.top, Math.max(1, fallback.width), 1)
  }
}

export function resolveCollisionPosition(
  x: number,
  y: number,
  floatingEl: HTMLElement
): { x: number; y: number; collides: boolean } {
  const width = Math.max(floatingEl.offsetWidth, floatingEl.getBoundingClientRect().width, 1)
  const height = Math.max(floatingEl.offsetHeight, floatingEl.getBoundingClientRect().height, 1)

  const controls = getVisibleAIZoneControlRects()
  const clampedInitial = clampToViewport(x, y, width, height, COLLISION_PADDING)
  const initialRect = new DOMRect(clampedInitial.x, clampedInitial.y, width, height)
  if (!overlapsAnyRect(initialRect, controls, COLLISION_PADDING)) {
    return { x: clampedInitial.x, y: clampedInitial.y, collides: false }
  }

  const viewportTop = COLLISION_PADDING
  const viewportLeft = COLLISION_PADDING
  const viewportRight =
    typeof window === 'undefined'
      ? clampedInitial.x
      : Math.max(COLLISION_PADDING, window.innerWidth - width - COLLISION_PADDING)
  const viewportBottom =
    typeof window === 'undefined'
      ? clampedInitial.y
      : Math.max(COLLISION_PADDING, window.innerHeight - height - COLLISION_PADDING)

  const candidates: Array<{ x: number; y: number }> = [
    clampedInitial,
    { x: clampedInitial.x, y: viewportTop },
    { x: clampedInitial.x, y: viewportBottom },
    { x: viewportLeft, y: clampedInitial.y },
    { x: viewportRight, y: clampedInitial.y },
    { x: viewportLeft, y: viewportTop },
    { x: viewportRight, y: viewportTop },
    { x: viewportLeft, y: viewportBottom },
    { x: viewportRight, y: viewportBottom },
  ]

  for (const control of controls) {
    candidates.push(
      { x: clampedInitial.x, y: control.top - height - COLLISION_PADDING },
      { x: clampedInitial.x, y: control.bottom + COLLISION_PADDING },
      { x: control.left - width - COLLISION_PADDING, y: clampedInitial.y },
      { x: control.right + COLLISION_PADDING, y: clampedInitial.y },
      { x: control.left - width - COLLISION_PADDING, y: control.top - height - COLLISION_PADDING },
      { x: control.right + COLLISION_PADDING, y: control.top - height - COLLISION_PADDING },
      { x: control.left - width - COLLISION_PADDING, y: control.bottom + COLLISION_PADDING },
      { x: control.right + COLLISION_PADDING, y: control.bottom + COLLISION_PADDING }
    )
  }

  let best = clampedInitial
  let bestOverlapArea = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const clamped = clampToViewport(candidate.x, candidate.y, width, height, COLLISION_PADDING)
    const rect = new DOMRect(clamped.x, clamped.y, width, height)

    if (!overlapsAnyRect(rect, controls, COLLISION_PADDING)) {
      return { x: clamped.x, y: clamped.y, collides: false }
    }

    const overlapArea = totalOverlapArea(rect, controls)
    if (overlapArea < bestOverlapArea) {
      best = clamped
      bestOverlapArea = overlapArea
    }
  }

  return { x: best.x, y: best.y, collides: true }
}

function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  padding: number
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

function getVisibleAIZoneControlRects(): DOMRect[] {
  const controls = document.querySelectorAll<HTMLElement>('.ai-writer-floating-controls')
  const rects: DOMRect[] = []

  for (const control of controls) {
    const rect = control.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      rects.push(new DOMRect(rect.left, rect.top, rect.width, rect.height))
    }
  }

  return rects
}

function overlapsAnyRect(target: DOMRect, others: DOMRect[], padding: number): boolean {
  for (const rect of others) {
    if (rectanglesOverlap(target, rect, padding)) {
      return true
    }
  }
  return false
}

function totalOverlapArea(target: DOMRect, others: DOMRect[]): number {
  let total = 0
  for (const rect of others) {
    const width = Math.min(target.right, rect.right) - Math.max(target.left, rect.left)
    const height = Math.min(target.bottom, rect.bottom) - Math.max(target.top, rect.top)
    if (width > 0 && height > 0) {
      total += width * height
    }
  }
  return total
}

function rectanglesOverlap(left: DOMRect, right: DOMRect, padding: number): boolean {
  return !(
    left.right + padding <= right.left ||
    left.left >= right.right + padding ||
    left.bottom + padding <= right.top ||
    left.top >= right.bottom + padding
  )
}
