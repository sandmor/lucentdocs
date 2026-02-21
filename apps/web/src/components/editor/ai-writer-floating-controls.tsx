import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom'
import type { EditorView } from 'prosemirror-view'
import { aiWriterPluginKey, type AIWriterState } from './ai-writer-plugin'
import {
  subscribeChoices,
  getChoicesSnapshot,
  subscribeAIState,
  getAIStateSnapshot,
  setAIChoices,
} from './ai-writer-store'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Check, X, Pen, Loader2 } from 'lucide-react'
import { schema } from './schema'

// Hooks

function useAIChoices(view: EditorView | null): string[] | null {
  return useSyncExternalStore(
    (cb) => (view ? subscribeChoices(view, cb) : () => {}),
    () => (view ? getChoicesSnapshot(view) : null),
    () => null
  )
}

function useAIWriterState(view: EditorView | null): AIWriterState | null {
  return useSyncExternalStore(
    (cb) => (view ? subscribeAIState(view, cb) : () => {}),
    () => (view ? getAIStateSnapshot(view) : null),
    () => null
  )
}

interface AIWriterFloatingControlsProps {
  view: EditorView | null
  onAccept: () => void
  onReject: () => void
}

export function AIWriterFloatingControls({
  view,
  onAccept,
  onReject,
}: AIWriterFloatingControlsProps) {
  const state = useAIWriterState(view)
  const choices = useAIChoices(view)
  const rootRef = useRef<HTMLDivElement>(null)

  const isActive = state?.active ?? false
  const mode = state?.mode ?? null
  const from = state?.from ?? null
  const to = state?.to ?? null
  const streaming = state?.streaming ?? false
  const stuck = state?.stuck ?? false
  const selFrom = state?.originalSelectionFrom ?? null
  const selTo = state?.originalSelectionTo ?? null

  // Positioning
  useEffect(() => {
    if (!view || !rootRef.current || !isActive) return

    const el = rootRef.current
    const anchorPos = mode === 'choices' ? (selTo ?? selFrom ?? 0) : (to ?? from ?? 0)

    const updatePosition = () => {
      const coords = view.coordsAtPos(anchorPos)
      const virtualEl = {
        getBoundingClientRect: () =>
          new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top),
      }
      computePosition(virtualEl, el, {
        placement: 'bottom-start',
        middleware: [offset(8), flip({ fallbackAxisSideDirection: 'end' }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        el.style.left = `${Math.round(x)}px`
        el.style.top = `${Math.round(y)}px`
      })
    }

    updatePosition()
    const cleanup = autoUpdate(
      {
        getBoundingClientRect: () => {
          const coords = view.coordsAtPos(anchorPos)
          return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
        },
      },
      el,
      updatePosition
    )

    return () => {
      cleanup()
    }
  }, [view, isActive, mode, from, to, selFrom, selTo])

  // Don't render if no active state or nowhere to anchor
  if (!isActive || !view) return null

  // For choices mode, render choices grid
  if (mode === 'choices') {
    return createPortal(
      <div
        ref={rootRef}
        className="ai-writer-floating-controls fixed z-60 flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md dark:shadow-black/40 dark:ring-white/10"
      >
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Pen className="size-3" />
            Replace with
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            title="Cancel (Escape)"
            data-action="reject"
            onPointerDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onReject()
            }}
          >
            <X className="size-3" />
          </Button>
        </div>

        {!choices || choices.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-3 text-muted-foreground">
            <span className="ai-fc-dot" />
            <span className="ai-fc-dot" />
            <span className="ai-fc-dot" />
            <span className="ml-1 text-xs">Generating options…</span>
          </div>
        ) : (
          <div
            className="grid gap-1 p-2"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
              maxWidth: '320px',
            }}
          >
            {choices.map((choice, i) => (
              <Button
                key={i}
                variant="outline"
                size="xs"
                className="truncate"
                title={choice}
                onPointerDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  selectChoice(view, choice, selFrom, selTo)
                }}
              >
                {choice}
              </Button>
            ))}
          </div>
        )}
      </div>,
      document.body
    )
  }

  // Standard mode: show accept/reject buttons
  if (from === null || to === null || from >= to) return null

  return createPortal(
    <div
      ref={rootRef}
      className="ai-writer-floating-controls fixed z-60 flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md dark:shadow-black/40 dark:ring-white/10"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Pen className="size-3" />
          Drafting
        </span>
        <span className="ml-auto">
          {streaming && stuck ? (
            <span className="flex items-center gap-1 text-amber-500 dark:text-amber-400">
              <Loader2 className="size-3 animate-spin" />
              <span className="text-[10px] font-medium">Stuck…</span>
            </span>
          ) : streaming ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <span className="ai-fc-dot" />
              <span className="ai-fc-dot" />
              <span className="ai-fc-dot" />
            </span>
          ) : null}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 p-1.5">
        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground hover:border-success/50 hover:bg-success/15 hover:text-success dark:hover:text-emerald-400"
          title="Accept (Tab)"
          data-action="accept"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onAccept()
          }}
        >
          <Check className="size-3" />
          Accept
          <Kbd>Tab</Kbd>
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          title="Reject (Esc)"
          data-action="reject"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onReject()
          }}
        >
          <X className="size-3" />
          Reject
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </div>,
    document.body
  )
}

/* ------------------------------------------------------------------ */
/*  Choice selection helper                                           */
/* ------------------------------------------------------------------ */

function selectChoice(
  view: EditorView,
  choice: string,
  selectionFrom: number | null,
  selectionTo: number | null
): void {
  if (selectionFrom === null || selectionTo === null) return

  const tr = view.state.tr

  if (selectionFrom < selectionTo) tr.delete(selectionFrom, selectionTo)

  tr.insert(selectionFrom, schema.text(choice))
  tr.setMeta(aiWriterPluginKey, { type: 'accept' })
  tr.setMeta('addToHistory', true)
  view.dispatch(tr)
  setAIChoices(view, null)
}
