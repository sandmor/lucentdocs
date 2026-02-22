import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from 'prosemirror-view'
import type { SelectionRange } from './selection-types'

interface SelectionFakeOverlayProps {
  view: EditorView | null
  selection: SelectionRange | null
  visible: boolean
}

interface RectSnapshot {
  from: number
  to: number
  rects: DOMRect[]
}

export function SelectionFakeOverlay({ view, selection, visible }: SelectionFakeOverlayProps) {
  const [snapshot, setSnapshot] = useState<RectSnapshot | null>(null)

  useEffect(() => {
    if (!view || !selection) return

    let cancelled = false
    let rafId = 0

    const updateRects = () => {
      if (cancelled) return

      const activeSelectionRects = getActiveDomSelectionRects(view)
      const nextRects =
        activeSelectionRects ?? (visible ? getSelectionClientRects(view, selection) : null)

      if (!nextRects || nextRects.length === 0) return

      setSnapshot((previous) => {
        if (
          previous &&
          previous.from === selection.from &&
          previous.to === selection.to &&
          sameRects(previous.rects, nextRects)
        ) {
          return previous
        }

        return {
          from: selection.from,
          to: selection.to,
          rects: nextRects,
        }
      })
    }

    const scheduleUpdate = () => {
      if (cancelled) return
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateRects)
    }

    scheduleUpdate()

    const resizeObserver = new ResizeObserver(() => {
      scheduleUpdate()
    })
    resizeObserver.observe(view.dom as HTMLElement)

    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)
    document.addEventListener('selectionchange', scheduleUpdate)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
      document.removeEventListener('selectionchange', scheduleUpdate)
    }
  }, [view, selection, visible])

  if (!visible || !view || !selection || selection.from >= selection.to) {
    return null
  }

  const visibleRects =
    snapshot && snapshot.from === selection.from && snapshot.to === selection.to
      ? snapshot.rects
      : []

  if (visibleRects.length === 0) {
    return null
  }

  return createPortal(
    <>
      {visibleRects.map((rect, index) => (
        <div
          key={`selection-overlay-${index}`}
          className="ai-selection-overlay pointer-events-none fixed z-[65] bg-foreground/[0.12]"
          style={{
            left: `${Math.round(rect.left)}px`,
            top: `${Math.round(rect.top)}px`,
            width: `${Math.round(rect.width)}px`,
            height: `${Math.round(rect.height)}px`,
          }}
        />
      ))}
    </>,
    document.body
  )
}

function getActiveDomSelectionRects(view: EditorView): DOMRect[] | null {
  if (typeof window === 'undefined') return null

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)
  if (!view.dom.contains(range.commonAncestorContainer)) {
    return null
  }

  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => new DOMRect(rect.left, rect.top, rect.width, rect.height))

  return rects.length > 0 ? rects : null
}

function getSelectionClientRects(view: EditorView, selection: SelectionRange): DOMRect[] {
  try {
    const fromDOM = view.domAtPos(selection.from)
    const toDOM = view.domAtPos(selection.to)
    const range = document.createRange()
    range.setStart(fromDOM.node, fromDOM.offset)
    range.setEnd(toDOM.node, toDOM.offset)

    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => new DOMRect(rect.left, rect.top, rect.width, rect.height))

    if (rects.length > 0) return rects
  } catch {
    // Fall back to coarse range when DOM mapping fails.
  }

  const fallback = getSelectionRect(view, selection)
  if (fallback.width <= 0 || fallback.height <= 0) return []
  return [fallback]
}

function getSelectionRect(view: EditorView, selection: SelectionRange): DOMRect {
  try {
    const docSize = view.state.doc.content.size
    const from = Math.max(0, Math.min(selection.from, docSize))
    const to = Math.max(0, Math.min(selection.to, docSize))
    const safeFrom = Math.min(from, to)
    const safeTo = Math.max(from, to)

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

function sameRects(previous: DOMRect[], next: DOMRect[]): boolean {
  if (previous.length !== next.length) return false

  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index]
    const right = next[index]
    if (
      Math.round(left.left) !== Math.round(right.left) ||
      Math.round(left.top) !== Math.round(right.top) ||
      Math.round(left.width) !== Math.round(right.width) ||
      Math.round(left.height) !== Math.round(right.height)
    ) {
      return false
    }
  }

  return true
}
