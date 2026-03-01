import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom'
import { toggleMark } from 'prosemirror-commands'
import type { MarkType } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { Bold, Check, Italic, Loader2, Pen, X } from 'lucide-react'
import { schema } from '@plotline/shared'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import { aiWriterPluginKey, type AIWriterState, type AIMode } from './ai-writer-plugin'
import { getAIStateSnapshot, subscribeAIState } from './ai-writer-store'
import type { SelectionRange } from './selection-types'

interface InlineAIControlsProps {
  view: EditorView | null
  selection: SelectionRange | null
  onGenerate: (prompt: string, selection: SelectionRange) => boolean
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
  onInteractionChange: (interacting: boolean) => void
}

type InlineControlState = 'compose' | 'processing' | 'review'
type FormatMarkName = 'strong' | 'em'

const COLLISION_PADDING = 8

function useAIWriterState(view: EditorView | null): AIWriterState | null {
  return useSyncExternalStore(
    (cb) => (view ? subscribeAIState(view, cb) : () => {}),
    () => (view ? getAIStateSnapshot(view) : null),
    () => null
  )
}

export function InlineAIControls({
  view,
  selection,
  onGenerate,
  onAccept,
  onReject,
  onInteractionChange,
}: InlineAIControlsProps) {
  const state = useAIWriterState(view)
  const hasSelection = Boolean(selection && selection.from < selection.to)

  const activeLoadingAnchor = useMemo(() => {
    if (!state?.active || !state.streaming) return null

    const activeZone = state.zoneId ? state.zones.find((zone) => zone.id === state.zoneId) : null
    if (activeZone) {
      return {
        zoneId: activeZone.id,
        from: activeZone.from,
        to: activeZone.to,
        mode: activeZone.mode,
      }
    }

    const from = state.originalSelectionFrom ?? state.from
    const to = state.originalSelectionTo ?? state.to

    if (from === null || to === null) return null

    return {
      zoneId: state.zoneId ?? undefined,
      from: Math.min(from, to),
      to: Math.max(from, to),
      mode: state.mode ?? null,
    }
  }, [state])

  const loadingZoneId = activeLoadingAnchor?.zoneId ?? null

  const reviewZones = useMemo(() => {
    if (!state) return []
    return state.zones.filter((zone) => zone.id !== loadingZoneId)
  }, [state, loadingZoneId])

  if (!view) return null

  return (
    <>
      {hasSelection ? (
        <SelectionComposeControl
          view={view}
          selection={selection!}
          onGenerate={onGenerate}
          onInteractionChange={onInteractionChange}
        />
      ) : null}

      {activeLoadingAnchor ? (
        <AIZoneControl
          key={`loading-${activeLoadingAnchor.zoneId ?? `${activeLoadingAnchor.from}-${activeLoadingAnchor.to}`}`}
          view={view}
          zoneId={activeLoadingAnchor.zoneId}
          from={activeLoadingAnchor.from}
          to={activeLoadingAnchor.to}
          mode={activeLoadingAnchor.mode}
          state="processing"
          choices={[]}
          stuck={Boolean(state?.stuck)}
          onAccept={onAccept}
          onReject={onReject}
        />
      ) : null}

      {reviewZones.map((zone) => (
        <AIZoneControl
          key={zone.id}
          view={view}
          zoneId={zone.id}
          from={zone.from}
          to={zone.to}
          mode={zone.mode}
          state={zone.streaming ? 'processing' : 'review'}
          choices={zone.choices}
          stuck={false}
          onAccept={onAccept}
          onReject={onReject}
        />
      ))}
    </>
  )
}

interface SelectionComposeControlProps {
  view: EditorView
  selection: SelectionRange
  onGenerate: (prompt: string, selection: SelectionRange) => boolean
  onInteractionChange: (interacting: boolean) => void
}

function SelectionComposeControl({
  view,
  selection,
  onGenerate,
  onInteractionChange,
}: SelectionComposeControlProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onInteractionChangeRef = useRef(onInteractionChange)
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    onInteractionChangeRef.current = onInteractionChange
  }, [onInteractionChange])

  const setInteracting = useCallback((next: boolean) => {
    onInteractionChangeRef.current(next)
  }, [])

  useEffect(() => {
    return () => {
      onInteractionChangeRef.current(false)
    }
  }, [])

  const runToggleMark = useCallback(
    (markName: FormatMarkName) => {
      const markType = resolveMarkType(view, markName)
      if (!markType) return

      const { from, to, empty } = view.state.selection
      if (empty || from >= to) return

      const command = toggleMark(markType)
      command(view.state, view.dispatch, view)
      view.focus()
    },
    [view]
  )

  const markActive = useMemo(() => {
    return {
      strong: isMarkActive(view, 'strong'),
      em: isMarkActive(view, 'em'),
    }
  }, [view, selection.from, selection.to])

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim()
    if (!trimmed) return

    const started = onGenerate(trimmed, selection)
    if (started) {
      setPrompt('')
    }
  }, [onGenerate, prompt, selection])

  useEffect(() => {
    if (!rootRef.current) return

    const floating = rootRef.current
    const placements: Placement[] = [
      'top',
      'right',
      'left',
      'bottom',
      'top-start',
      'top-end',
      'right-start',
      'right-end',
      'left-start',
      'left-end',
      'bottom-start',
      'bottom-end',
    ]

    const reference = {
      getBoundingClientRect: () => getSelectionRect(view, selection),
      contextElement: view.dom as HTMLElement,
    }

    let cancelled = false
    let rafId = 0

    const updatePosition = async () => {
      if (!rootRef.current || cancelled) return

      const floatingEl = rootRef.current
      let fallbackResult: { x: number; y: number; collides: boolean } | null = null

      for (const placement of placements) {
        try {
          const result = await computePosition(reference, floatingEl, {
            placement,
            middleware: [
              offset(12),
              flip({ fallbackAxisSideDirection: 'start', padding: COLLISION_PADDING }),
              shift({ padding: COLLISION_PADDING, crossAxis: true }),
            ],
          })

          const resolvedResult = resolveCollisionPosition(result.x, result.y, floatingEl)
          if (!fallbackResult) fallbackResult = resolvedResult

          if (!resolvedResult.collides) {
            applyPosition(floatingEl, resolvedResult.x, resolvedResult.y)
            return
          }
        } catch {
          continue
        }
      }

      if (fallbackResult) {
        applyPosition(floatingEl, fallbackResult.x, fallbackResult.y)
      }
    }

    const scheduleUpdate = () => {
      if (cancelled) return
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        void updatePosition()
      })
    }

    scheduleUpdate()

    const floatingResizeObserver = new ResizeObserver(() => {
      scheduleUpdate()
    })
    floatingResizeObserver.observe(floating)

    const editorResizeObserver = new ResizeObserver(() => {
      scheduleUpdate()
    })
    editorResizeObserver.observe(view.dom as HTMLElement)

    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)

    const controlsObserver = new MutationObserver(() => {
      scheduleUpdate()
    })

    const watchControls = () => {
      controlsObserver.disconnect()
      const controls = document.querySelectorAll<HTMLElement>('.ai-writer-floating-controls')
      for (const control of controls) {
        if (control === floating) continue
        controlsObserver.observe(control, {
          attributes: true,
          attributeFilter: ['style', 'class'],
        })
      }
    }

    watchControls()

    const controlsListObserver = new MutationObserver(() => {
      watchControls()
      scheduleUpdate()
    })
    controlsListObserver.observe(document.body, { childList: true, subtree: true })

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      floatingResizeObserver.disconnect()
      editorResizeObserver.disconnect()
      controlsObserver.disconnect()
      controlsListObserver.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
    }
  }, [view, selection, prompt.length])

  useEffect(() => {
    if (!rootRef.current) return
    const root = rootRef.current

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.target || !(event.target instanceof Node)) return
      if (root.contains(event.target)) return
      setInteracting(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [setInteracting])

  return createPortal(
    <div
      ref={rootRef}
      className="ai-inline-controls ai-selection-toolbar fixed z-70 flex w-[min(94vw,420px)] flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md duration-150 dark:shadow-black/40 dark:ring-white/10"
      data-testid="ai-inline-controls"
      data-state="compose"
      onPointerDownCapture={() => setInteracting(true)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (
          !nextTarget ||
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setInteracting(false)
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Pen className="size-3" />
          Selection
        </span>
      </div>

      <div className="space-y-2 p-2">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe what should change..."
          className="min-h-18 text-sm"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              handleSubmit()
            }
          }}
        />

        <div className="flex items-center gap-1 px-1">
          <Button
            variant={markActive.strong ? 'secondary' : 'ghost'}
            size="icon-xs"
            data-action="format-bold"
            title="Bold"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              runToggleMark('strong')
            }}
          >
            <Bold className="size-3" />
          </Button>
          <Button
            variant={markActive.em ? 'secondary' : 'ghost'}
            size="icon-xs"
            data-action="format-italic"
            title="Italic"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              runToggleMark('em')
            }}
          >
            <Italic className="size-3" />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 px-1">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            Send with
            <Kbd>Ctrl/Cmd</Kbd>
            <Kbd>Enter</Kbd>
          </span>

          <Button size="xs" onClick={handleSubmit} disabled={!prompt.trim()}>
            <Pen className="size-3" data-icon="inline-start" />
            Rewrite
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

interface AIZoneControlProps {
  view: EditorView
  zoneId?: string
  from: number
  to: number
  mode: AIMode | null
  state: InlineControlState
  choices: string[]
  stuck: boolean
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
}

function AIZoneControl({
  view,
  zoneId,
  from,
  to,
  mode,
  state,
  choices,
  stuck,
  onAccept,
  onReject,
}: AIZoneControlProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  const getZoneAnchorElement = useCallback((): HTMLElement | null => {
    if (!zoneId) return null

    const escapedId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(zoneId)
        : zoneId.replace(/["\\]/g, '\\$&')

    const matches = view.dom.querySelectorAll<HTMLElement>(
      `.ai-generating-text[data-ai-zone-id="${escapedId}"]`
    )
    if (matches.length === 0) return null
    return matches[matches.length - 1]
  }, [view, zoneId])

  useEffect(() => {
    if (!rootRef.current) return

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

      const docSize = view.state.doc.content.size
      const safeFrom = Math.max(0, Math.min(Math.min(from, to), docSize))
      const safeTo = Math.max(0, Math.min(Math.max(from, to), docSize))
      const fallbackPos = Math.max(0, Math.min(safeTo || safeFrom, docSize))
      const coords = view.coordsAtPos(fallbackPos)
      const virtualEl = {
        getBoundingClientRect: () =>
          new DOMRect(coords.left, coords.top, Math.max(1, coords.right - coords.left), 1),
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
  }, [view, zoneId, from, to, mode, state, stuck, choices.length, getZoneAnchorElement])

  const isProcessing = state === 'processing'
  const isReview = state === 'review'

  return createPortal(
    <div
      ref={rootRef}
      className="ai-inline-controls ai-writer-floating-controls fixed z-60 flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md dark:shadow-black/40 dark:ring-white/10"
      data-testid="ai-inline-controls"
      data-state={state}
      data-zone-id={zoneId}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Pen className="size-3" />
          {isProcessing ? 'Loading' : 'AI Zone'}
        </span>
        <span className="ml-auto">
          {isProcessing ? (
            stuck ? (
              <span className="flex items-center gap-1 text-amber-500 dark:text-amber-400">
                <Loader2 className="size-3 animate-spin" />
                <span className="text-[10px] font-medium">Stuck…</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                <span className="text-[10px] font-medium">Processing</span>
              </span>
            )
          ) : null}
        </span>
      </div>

      {isProcessing ? (
        <div className="flex items-center justify-center gap-2 px-4 py-3 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span className="text-xs">Awaiting AI response…</span>
        </div>
      ) : mode === 'choices' ? (
        <>
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
              {choices.map((choice, index) => (
                <Button
                  key={`${zoneId ?? 'zone'}-choice-${index}`}
                  variant="outline"
                  size="xs"
                  className="truncate"
                  title={choice}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    selectChoice(view, choice, from, to)
                  }}
                >
                  {choice}
                </Button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end p-1.5 pt-0">
            <Button
              variant="ghost"
              size="xs"
              className="gap-1.5 text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              title="Reject (Esc)"
              data-action="reject"
              onPointerDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onReject(zoneId)
              }}
            >
              <X className="size-3" />
              Reject
              <Kbd>Esc</Kbd>
            </Button>
          </div>
        </>
      ) : isReview ? (
        <div className="flex items-center gap-1.5 p-1.5">
          <Button
            variant="ghost"
            size="xs"
            className="gap-1.5 text-muted-foreground hover:border-success/50 hover:bg-success/15 hover:text-success dark:hover:text-emerald-400"
            title="Accept (Tab)"
            data-action="accept"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onAccept(zoneId)
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
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onReject(zoneId)
            }}
          >
            <X className="size-3" />
            Reject
            <Kbd>Esc</Kbd>
          </Button>
        </div>
      ) : null}
    </div>,
    document.body
  )
}

function resolveMarkType(view: EditorView, markName: FormatMarkName): MarkType | null {
  return view.state.schema.marks[markName] ?? null
}

function isMarkActive(view: EditorView, markName: FormatMarkName): boolean {
  const markType = resolveMarkType(view, markName)
  if (!markType) return false

  const { from, to, empty } = view.state.selection
  if (empty) {
    const stored = view.state.storedMarks ?? view.state.selection.$from.marks()
    return stored.some((mark) => mark.type === markType)
  }

  return view.state.doc.rangeHasMark(from, to, markType)
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

function applyPosition(element: HTMLElement, x: number, y: number): void {
  element.style.left = `${Math.round(x)}px`
  element.style.top = `${Math.round(y)}px`
}

function getSelectionRect(view: EditorView, selection: SelectionRange): DOMRect {
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

function resolveCollisionPosition(
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
