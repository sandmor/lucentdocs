import { useEffect, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import {
  computeLeftGutterContainerX,
  getRangeBandRect,
} from './side-elements/layout'
import { subscribeEditorView } from './prosemirror/view-store'

export interface SearchResultMarker {
  id: string
  from: number
  to: number
}

interface SearchResultMarkersProps {
  view: EditorView | null
  container: HTMLElement | null
  markers: SearchResultMarker[]
}

interface MarkerRect {
  id: string
  top: number
  height: number
}

interface MarkerSnapshot {
  left: number
  markers: MarkerRect[]
}

const MARKER_WIDTH = 4
const MIN_MARKER_HEIGHT = 18

export function SearchResultMarkers({ view, container, markers }: SearchResultMarkersProps) {
  const [snapshot, setSnapshot] = useState<MarkerSnapshot | null>(null)

  useEffect(() => {
    if (!view || !container || markers.length === 0) return

    let cancelled = false
    let rafId = 0

    const updateMarkers = () => {
      if (cancelled) return

      const next = collectMarkerSnapshot(view, container, markers)
      setSnapshot((previous) => (sameSnapshot(previous, next) ? previous : next))
    }

    const scheduleUpdate = () => {
      if (cancelled) return
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateMarkers)
    }

    scheduleUpdate()

    const resizeObserver = new ResizeObserver(() => {
      scheduleUpdate()
    })
    resizeObserver.observe(view.dom as HTMLElement)
    resizeObserver.observe(container)

    const unsubscribeView = subscribeEditorView(view, scheduleUpdate)

    window.addEventListener('resize', scheduleUpdate)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      unsubscribeView()
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [view, container, markers])

  if (!view || !container || markers.length === 0 || !snapshot || snapshot.markers.length === 0) {
    return null
  }

  return (
    <>
      {snapshot.markers.map((marker) => (
        <div
          key={marker.id}
          data-editor-search-result-marker={marker.id}
          className="pointer-events-none absolute z-58 rounded-full bg-primary/75 shadow-[0_0_0_1px_color-mix(in_oklch,var(--background)_35%,transparent)]"
          style={{
            left: `${Math.round(snapshot.left)}px`,
            top: `${Math.round(marker.top)}px`,
            width: `${MARKER_WIDTH}px`,
            height: `${Math.round(marker.height)}px`,
          }}
        />
      ))}
    </>
  )
}

function collectMarkerSnapshot(
  view: EditorView,
  container: HTMLElement,
  markers: SearchResultMarker[]
): MarkerSnapshot | null {
  const editorRect = view.dom.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const docSize = view.state.doc.content.size
  if (docSize <= 0) return null

  const markerRects = markers
    .map((marker): MarkerRect | null => {
      const from = clampPosition(marker.from, docSize)
      const to = clampPosition(Math.max(marker.to, marker.from), docSize)
      const rect = getRangeBandRect(view, from, Math.max(from, to))
      if (!rect) return null

      return {
        id: marker.id,
        top: rect.top - containerRect.top,
        height: Math.max(MIN_MARKER_HEIGHT, rect.bottom - rect.top),
      }
    })
    .filter((marker): marker is MarkerRect => marker !== null)

  if (markerRects.length === 0) return null

  return {
    left: computeLeftGutterContainerX(editorRect, containerRect, 0),
    markers: markerRects,
  }
}

function clampPosition(position: number, docSize: number): number {
  return Math.max(1, Math.min(position, docSize))
}

function sameSnapshot(previous: MarkerSnapshot | null, next: MarkerSnapshot | null): boolean {
  if (!previous || !next) return previous === next
  if (Math.round(previous.left) !== Math.round(next.left)) return false
  if (previous.markers.length !== next.markers.length) return false

  for (let index = 0; index < previous.markers.length; index += 1) {
    const left = previous.markers[index]
    const right = next.markers[index]
    if (
      left.id !== right.id ||
      Math.round(left.top) !== Math.round(right.top) ||
      Math.round(left.height) !== Math.round(right.height)
    ) {
      return false
    }
  }

  return true
}
