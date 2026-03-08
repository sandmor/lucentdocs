import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Y from 'yjs'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from 'y-prosemirror'
import type { EditorView } from 'prosemirror-view'
import {
  DEFAULT_CURSOR_STATE_FIELD,
  type CollaborationAwareness,
  type CollaborationPresenceCursor,
  normalizePresenceUser,
  samePresenceRects,
} from '../prosemirror/presence'
import { getSelectionRangeInView } from '../selection/dom-selection'
import { subscribeEditorView } from '../prosemirror/view-store'

interface RemotePresenceOverlayProps {
  view: EditorView | null
  awareness: CollaborationAwareness | null
  cursorStateField?: string
}

interface PresenceRect {
  left: number
  top: number
  width: number
  height: number
}

interface RemotePresenceSnapshot {
  clientId: number
  name: string
  color: string
  caret: PresenceRect | null
  selectionRects: PresenceRect[]
}

interface SyncStateSnapshot {
  doc: Y.Doc
  type: Y.XmlFragment
  binding: {
    mapping: Map<Y.AbstractType<unknown>, unknown>
  }
}

export function RemotePresenceOverlay({
  view,
  awareness,
  cursorStateField = DEFAULT_CURSOR_STATE_FIELD,
}: RemotePresenceOverlayProps) {
  const [snapshot, setSnapshot] = useState<RemotePresenceSnapshot[]>([])

  useEffect(() => {
    if (!view || !awareness) {
      return
    }

    let cancelled = false
    let rafId = 0

    const publish = () => {
      if (cancelled) return
      publishLocalPresenceCursor(view, awareness, cursorStateField)
    }

    const schedulePublish = () => {
      if (cancelled) return
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(publish)
    }

    const unsubscribeView = subscribeEditorView(view, schedulePublish)

    view.dom.addEventListener('focusin', schedulePublish)
    view.dom.addEventListener('focusout', schedulePublish)
    view.dom.addEventListener('mouseup', schedulePublish)
    view.dom.addEventListener('keyup', schedulePublish)
    view.dom.addEventListener('compositionend', schedulePublish)
    document.addEventListener('selectionchange', schedulePublish)

    schedulePublish()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      unsubscribeView()
      awareness.setLocalStateField(cursorStateField, null)
      view.dom.removeEventListener('focusin', schedulePublish)
      view.dom.removeEventListener('focusout', schedulePublish)
      view.dom.removeEventListener('mouseup', schedulePublish)
      view.dom.removeEventListener('keyup', schedulePublish)
      view.dom.removeEventListener('compositionend', schedulePublish)
      document.removeEventListener('selectionchange', schedulePublish)
    }
  }, [view, awareness, cursorStateField])

  useEffect(() => {
    if (!view || !awareness) {
      return
    }

    let cancelled = false
    let rafId = 0

    const recompute = () => {
      if (cancelled) return

      const next = collectRemotePresence(view, awareness, cursorStateField)

      setSnapshot((previous) => (samePresenceSnapshot(previous, next) ? previous : next))
    }

    const scheduleRecompute = () => {
      if (cancelled) return
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(recompute)
    }

    const unsubscribeView = subscribeEditorView(view, scheduleRecompute)
    const awarenessListener = () => {
      scheduleRecompute()
    }
    const handleFocusChange = () => {
      scheduleRecompute()
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleRecompute()
    })
    resizeObserver.observe(view.dom as HTMLElement)

    awareness.on('change', awarenessListener)
    view.dom.addEventListener('focusin', handleFocusChange)
    view.dom.addEventListener('focusout', handleFocusChange)
    window.addEventListener('resize', scheduleRecompute)
    window.addEventListener('scroll', scheduleRecompute, true)

    scheduleRecompute()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      unsubscribeView()
      resizeObserver.disconnect()
      awareness.off('change', awarenessListener)
      view.dom.removeEventListener('focusin', handleFocusChange)
      view.dom.removeEventListener('focusout', handleFocusChange)
      window.removeEventListener('resize', scheduleRecompute)
      window.removeEventListener('scroll', scheduleRecompute, true)
    }
  }, [view, awareness, cursorStateField])

  if (!view || !awareness || snapshot.length === 0) {
    return null
  }

  return createPortal(
    <>
      {snapshot.flatMap((presence) =>
        presence.selectionRects.map((rect, index) => (
          <div
            key={`remote-presence-selection-${presence.clientId}-${index}`}
            className="ai-remote-presence-selection pointer-events-none fixed z-64"
            style={{
              left: `${rect.left}px`,
              top: `${rect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              backgroundColor: `${presence.color}33`,
            }}
          />
        ))
      )}
      {snapshot.map((presence) => {
        if (!presence.caret) return null

        return (
          <div
            key={`remote-presence-caret-${presence.clientId}`}
            className="ai-remote-presence-caret pointer-events-none fixed z-65"
            style={{
              left: `${presence.caret.left}px`,
              top: `${presence.caret.top}px`,
              height: `${presence.caret.height}px`,
              borderColor: presence.color,
            }}
          >
            <div
              className="ai-remote-presence-label"
              style={{
                backgroundColor: presence.color,
              }}
            >
              {presence.name}
            </div>
          </div>
        )
      })}
    </>,
    document.body
  )
}

function publishLocalPresenceCursor(
  view: EditorView,
  awareness: CollaborationAwareness,
  cursorStateField: string
): void {
  const syncState = getSyncState(view)
  if (!syncState) return

  const currentState = asPresenceRecord(awareness.getLocalState())
  const currentCursor = asPresenceCursor(currentState?.[cursorStateField])

  if (!view.hasFocus()) {
    if (currentCursor !== null) {
      awareness.setLocalStateField(cursorStateField, null)
    }
    return
  }

  const selection = getSelectionRangeInView(view)
  if (!selection) {
    return
  }

  const nextCursor = {
    anchor: absolutePositionToRelativePosition(
      selection.anchor,
      syncState.type,
      syncState.binding.mapping as never
    ),
    head: absolutePositionToRelativePosition(
      selection.head,
      syncState.type,
      syncState.binding.mapping as never
    ),
  }

  if (
    currentCursor &&
    Y.compareRelativePositions(
      Y.createRelativePositionFromJSON(currentCursor.anchor),
      nextCursor.anchor
    ) &&
    Y.compareRelativePositions(
      Y.createRelativePositionFromJSON(currentCursor.head),
      nextCursor.head
    )
  ) {
    return
  }

  awareness.setLocalStateField(cursorStateField, nextCursor)
}

function collectRemotePresence(
  view: EditorView,
  awareness: CollaborationAwareness,
  cursorStateField: string
): RemotePresenceSnapshot[] {
  const syncState = getSyncState(view)
  if (!syncState) return []

  const docSize = view.state.doc.content.size
  const snapshots: RemotePresenceSnapshot[] = []

  awareness.getStates().forEach((rawState, clientId) => {
    if (clientId === awareness.clientID) {
      return
    }

    const presenceState = asPresenceRecord(rawState)
    const cursor = asPresenceCursor(presenceState?.[cursorStateField])
    if (!cursor) {
      return
    }

    const anchor = relativePositionToAbsolutePosition(
      syncState.doc,
      syncState.type,
      Y.createRelativePositionFromJSON(cursor.anchor),
      syncState.binding.mapping as never
    )
    const head = relativePositionToAbsolutePosition(
      syncState.doc,
      syncState.type,
      Y.createRelativePositionFromJSON(cursor.head),
      syncState.binding.mapping as never
    )

    if (anchor === null || head === null) {
      return
    }

    const from = clampPosition(Math.min(anchor, head), docSize)
    const to = clampPosition(Math.max(anchor, head), docSize)
    const user = normalizePresenceUser(presenceState?.user, clientId)

    snapshots.push({
      clientId,
      name: user.name,
      color: user.color,
      caret: from === to ? getCaretRect(view, from) : null,
      selectionRects: from === to ? [] : getSelectionRects(view, from, to),
    })
  })

  return snapshots.sort((left, right) => left.clientId - right.clientId)
}

function getSyncState(view: EditorView): SyncStateSnapshot | null {
  const syncState = ySyncPluginKey.getState(view.state) as SyncStateSnapshot | undefined
  if (!syncState?.binding) return null
  return syncState
}

function getCaretRect(view: EditorView, position: number): PresenceRect | null {
  const safePosition = clampPosition(position, view.state.doc.content.size)
  const docSize = view.state.doc.content.size

  const beforeRects =
    safePosition > 0 ? getTextRangeRects(view, safePosition - 1, safePosition) : []
  if (beforeRects.length > 0) {
    const rect = beforeRects[beforeRects.length - 1]
    return {
      left: Math.round(rect.left + rect.width),
      top: Math.round(rect.top),
      width: 0,
      height: Math.max(1, Math.round(rect.height)),
    }
  }

  const afterRects =
    safePosition < docSize ? getTextRangeRects(view, safePosition, safePosition + 1) : []
  if (afterRects.length > 0) {
    const rect = afterRects[0]
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: 0,
      height: Math.max(1, Math.round(rect.height)),
    }
  }

  try {
    const resolved = view.state.doc.resolve(safePosition)
    const side =
      safePosition === 0 ? 1 : resolved.parentOffset === resolved.parent.content.size ? -1 : 1
    const coords = view.coordsAtPos(safePosition, side)

    return {
      left: Math.round(Math.min(coords.left, coords.right)),
      top: Math.round(coords.top),
      width: Math.max(0, Math.round(Math.abs(coords.right - coords.left))),
      height: Math.max(1, Math.round(coords.bottom - coords.top)),
    }
  } catch {
    return null
  }
}

function getTextRangeRects(view: EditorView, from: number, to: number): DOMRect[] {
  try {
    const start = view.domAtPos(from)
    const end = view.domAtPos(to)
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)

    return Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => new DOMRect(rect.left, rect.top, rect.width, rect.height))
  } catch {
    return []
  }
}

function getSelectionRects(view: EditorView, from: number, to: number): PresenceRect[] {
  const rects = getTextRangeRects(view, from, to)
  if (rects.length > 0) {
    return rects.map((rect) => ({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }))
  }

  const start = getCaretRect(view, from)
  const end = getCaretRect(view, to)
  if (!start || !end) return []

  return [
    {
      left: Math.min(start.left, end.left),
      top: Math.min(start.top, end.top),
      width: Math.max(1, Math.abs(end.left - start.left)),
      height: Math.max(start.height, end.height),
    },
  ]
}

function samePresenceSnapshot(
  previous: RemotePresenceSnapshot[],
  next: RemotePresenceSnapshot[]
): boolean {
  if (previous.length !== next.length) return false

  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index]
    const right = next[index]

    if (
      left.clientId !== right.clientId ||
      left.name !== right.name ||
      left.color !== right.color ||
      !sameRect(left.caret, right.caret) ||
      !samePresenceRects(left.selectionRects, right.selectionRects)
    ) {
      return false
    }
  }

  return true
}

function sameRect(left: PresenceRect | null, right: PresenceRect | null): boolean {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height
  )
}

function clampPosition(position: number, docSize: number): number {
  return Math.max(0, Math.min(position, docSize))
}

function asPresenceRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function asPresenceCursor(value: unknown): CollaborationPresenceCursor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const cursor = value as Record<string, unknown>
  if (!('anchor' in cursor) || !('head' in cursor)) {
    return null
  }

  return {
    anchor: cursor.anchor,
    head: cursor.head,
  }
}
