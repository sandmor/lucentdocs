import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw, X } from 'lucide-react'
import type { EditorView } from 'prosemirror-view'
import type { InlineZoneSession } from '@lucentdocs/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  clampSideElementToViewport,
  computeLeftGutterViewportX,
  getEditorContentRect,
} from '../side-elements/layout'
import { autoUpdate } from '@floating-ui/dom'

interface RestoreSuggestionChipProps {
  view: EditorView
  sessionId: string
  session: InlineZoneSession
  onRestore: (sessionId: string) => void
  onDismiss: (sessionId: string) => void
}

function findContextAnchorPosition(view: EditorView, contextBefore: string | null): number | null {
  if (!contextBefore) return null
  const anchor = contextBefore.slice(-64)
  if (!anchor) return null

  const doc = view.state.doc
  const docEnd = doc.content.size
  let targetLength = -1

  for (let pos = 0; pos <= docEnd; pos++) {
    const text = doc.textBetween(0, pos, '\n\n', '\n')
    if (text.endsWith(anchor)) {
      targetLength = text.length
    }
  }

  if (targetLength < 0) return null

  for (let pos = 0; pos <= docEnd; pos++) {
    if (doc.textBetween(0, pos, '\n\n', '\n').length === targetLength) {
      return pos
    }
  }

  return null
}

export function RestoreSuggestionChip({
  view,
  sessionId,
  session,
  onRestore,
  onDismiss,
}: RestoreSuggestionChipProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  const getAnchorRect = useCallback((): DOMRect | null => {
    const anchorPos = findContextAnchorPosition(view, session.contextBefore)
    if (anchorPos === null) return null

    try {
      const coords = view.coordsAtPos(anchorPos)
      return new DOMRect(coords.left, coords.top, 1, Math.max(1, coords.bottom - coords.top))
    } catch {
      return null
    }
  }, [session.contextBefore, view])

  useEffect(() => {
    if (!rootRef.current) return

    const el = rootRef.current
    let cancelled = false
    let rafId = 0

    const updatePosition = () => {
      if (!rootRef.current || cancelled) return
      const anchorRect = getAnchorRect()
      if (!anchorRect) return

      const editorRect = getEditorContentRect(view)
      const width = Math.max(el.offsetWidth, 1)
      const height = Math.max(el.offsetHeight, 1)
      const x = computeLeftGutterViewportX(editorRect, width)
      const y = anchorRect.top
      const clamped = clampSideElementToViewport(x, y, width, height)
      el.style.left = `${clamped.x}px`
      el.style.top = `${clamped.y}px`
    }

    const scheduleUpdate = () => {
      if (cancelled) return
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updatePosition)
    }

    scheduleUpdate()
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(el)
    const cleanupAutoUpdate = autoUpdate(view.dom as HTMLElement, el, scheduleUpdate)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      cleanupAutoUpdate()
    }
  }, [getAnchorRect, view])

  return createPortal(
    <div
      ref={rootRef}
      className="fixed z-30"
      data-testid="restore-suggestion-chip"
      data-session-id={sessionId}
    >
      <div
        className={cn(
          'flex items-center overflow-hidden rounded-lg border border-border',
          'bg-background/95 shadow-md shadow-black/5 ring-1 ring-black/5 backdrop-blur-md',
          'dark:shadow-black/40 dark:ring-white/10'
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="gap-1.5 rounded-none px-2.5 text-muted-foreground hover:text-foreground"
          data-action="restore-suggestion"
          title="Restore AI edit for review"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRestore(sessionId)
          }}
        >
          <RotateCcw className="size-3 shrink-0" strokeWidth={2.25} aria-hidden />
          Restore AI edit
        </Button>
        <div className="h-4 w-px shrink-0 bg-border" aria-hidden />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-none text-muted-foreground hover:bg-foreground/5"
          data-action="dismiss-restore-suggestion"
          title="Dismiss"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDismiss(sessionId)
          }}
        >
          <X className="size-3" />
        </Button>
      </div>
    </div>,
    document.body
  )
}
