import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom'
import type { EditorView } from 'prosemirror-view'
import {
  aiWriterPluginKey,
  getPrimaryAIZoneFromState,
  type AIWriterState,
} from './ai-writer-plugin'
import { subscribeAIState, getAIStateSnapshot } from './ai-writer-store'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Check, X, Pen, Loader2 } from 'lucide-react'
import { schema } from '@plotline/shared'

function useAIWriterState(view: EditorView | null): AIWriterState | null {
  return useSyncExternalStore(
    (cb) => (view ? subscribeAIState(view, cb) : () => {}),
    () => (view ? getAIStateSnapshot(view) : null),
    () => null
  )
}

interface AIWriterFloatingControlsProps {
  view: EditorView | null
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
}

export function AIWriterFloatingControls({
  view,
  onAccept,
  onReject,
}: AIWriterFloatingControlsProps) {
  const state = useAIWriterState(view)
  const rootRef = useRef<HTMLDivElement>(null)

  const zone = getPrimaryAIZoneFromState(state)
  const mode = zone?.mode ?? state?.mode ?? null
  const from = zone?.from ?? state?.from ?? null
  const to = zone?.to ?? state?.to ?? null
  const streaming = zone?.streaming ?? state?.streaming ?? false
  const stuck = (state?.stuck ?? false) && (state?.zoneId === zone?.id || !zone)
  const choices = mode === 'choices' ? (zone?.choices ?? []) : null

  const getZoneAnchorElement = useCallback((): HTMLElement | null => {
    if (!view || !zone?.id) return null

    const escapedId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(zone.id)
        : zone.id.replace(/["\\]/g, '\\$&')

    const matches = view.dom.querySelectorAll<HTMLElement>(
      `.ai-generating-text[data-ai-zone-id="${escapedId}"]`
    )
    if (matches.length === 0) return null
    return matches[matches.length - 1]
  }, [view, zone?.id])

  useEffect(() => {
    if (!view || !rootRef.current || from === null || to === null) return

    const el = rootRef.current

    const updatePosition = () => {
      const anchorElement = getZoneAnchorElement()

      if (anchorElement) {
        computePosition(anchorElement, el, {
          placement: 'bottom-start',
          middleware: [
            offset(8),
            flip({ fallbackAxisSideDirection: 'end' }),
            shift({ padding: 8 }),
          ],
        }).then(({ x, y }) => {
          el.style.left = `${Math.round(x)}px`
          el.style.top = `${Math.round(y)}px`
        })
        return
      }

      const fallbackPos = Math.max(0, Math.min(to, view.state.doc.content.size))
      const coords = view.coordsAtPos(fallbackPos)
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
    const cleanup = autoUpdate(view.dom as HTMLElement, el, updatePosition, {
      animationFrame: true,
    })

    return () => {
      cleanup()
    }
  }, [view, zone?.id, mode, from, to, choices?.length, streaming, stuck, getZoneAnchorElement])

  if (!view || from === null || to === null || from >= to) return null

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
              onReject(zone?.id)
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
                  selectChoice(view, choice, from, to)
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

  return createPortal(
    <div
      ref={rootRef}
      className="ai-writer-floating-controls fixed z-60 flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md dark:shadow-black/40 dark:ring-white/10"
    >
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
            onAccept(zone?.id)
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
            onReject(zone?.id)
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

function selectChoice(
  view: EditorView,
  choice: string,
  selectionFrom: number,
  selectionTo: number
): void {
  if (selectionFrom >= selectionTo) return

  const tr = view.state.tr
  const markType = view.state.schema.marks.ai_zone ?? null
  tr.delete(selectionFrom, selectionTo)
  tr.insert(selectionFrom, schema.text(choice))
  if (markType) {
    tr.removeMark(selectionFrom, selectionFrom + choice.length, markType)
  }
  tr.setMeta(aiWriterPluginKey, { type: 'accept' })
  tr.setMeta('addToHistory', true)
  view.dispatch(tr)
}
