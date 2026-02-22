import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom'
import type { EditorView } from 'prosemirror-view'
import { Pen, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import type { SelectionRange } from './selection-types'

interface SelectionAIToolbarProps {
  view: EditorView | null
  selection: SelectionRange | null
  isGenerating: boolean
  onGenerate: (prompt: string, selection: SelectionRange) => boolean
  onInteractionChange: (interacting: boolean) => void
}

const COLLISION_PADDING = 8
const EXIT_ANIMATION_MS = 140
const CLOSE_GRACE_MS = 80

export function SelectionAIToolbar({
  view,
  selection,
  isGenerating,
  onGenerate,
  onInteractionChange,
}: SelectionAIToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onInteractionChangeRef = useRef(onInteractionChange)
  const closeStartTimeoutRef = useRef<number | null>(null)
  const unmountTimeoutRef = useRef<number | null>(null)
  const [prompt, setPrompt] = useState('')
  const [renderSelection, setRenderSelection] = useState<SelectionRange | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  const hasLiveSelection = Boolean(selection && selection.from < selection.to)
  const activeSelection = renderSelection

  useEffect(() => {
    onInteractionChangeRef.current = onInteractionChange
  }, [onInteractionChange])

  useEffect(() => {
    let openRafId: number | null = null

    if (closeStartTimeoutRef.current !== null) {
      window.clearTimeout(closeStartTimeoutRef.current)
      closeStartTimeoutRef.current = null
    }
    if (unmountTimeoutRef.current !== null) {
      window.clearTimeout(unmountTimeoutRef.current)
      unmountTimeoutRef.current = null
    }

    if (hasLiveSelection && selection) {
      openRafId = window.requestAnimationFrame(() => {
        setRenderSelection((previous) => {
          if (previous && previous.from === selection.from && previous.to === selection.to) {
            return previous
          }
          return selection
        })
        setIsVisible(true)
      })
    } else if (renderSelection) {
      closeStartTimeoutRef.current = window.setTimeout(() => {
        setIsVisible(false)
        unmountTimeoutRef.current = window.setTimeout(() => {
          setRenderSelection(null)
          unmountTimeoutRef.current = null
        }, EXIT_ANIMATION_MS)
      }, CLOSE_GRACE_MS)
    }

    return () => {
      if (openRafId !== null) {
        window.cancelAnimationFrame(openRafId)
      }
      if (closeStartTimeoutRef.current !== null) {
        window.clearTimeout(closeStartTimeoutRef.current)
        closeStartTimeoutRef.current = null
      }
      if (unmountTimeoutRef.current !== null) {
        window.clearTimeout(unmountTimeoutRef.current)
        unmountTimeoutRef.current = null
      }
    }
  }, [hasLiveSelection, selection, renderSelection])

  const handleSubmit = useCallback(() => {
    if (!activeSelection || !isVisible) return
    if (!prompt.trim() || isGenerating) return

    const started = onGenerate(prompt.trim(), activeSelection)
    if (started) {
      setPrompt('')
    }
  }, [activeSelection, isVisible, prompt, isGenerating, onGenerate])

  const setInteracting = useCallback((next: boolean) => {
    onInteractionChangeRef.current(next)
  }, [])

  useEffect(() => {
    return () => {
      onInteractionChangeRef.current(false)
    }
  }, [])

  useEffect(() => {
    if (!view || !activeSelection || !rootRef.current) return

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
      getBoundingClientRect: () => getSelectionRect(view, activeSelection),
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

    const zoneControlsObserver = new MutationObserver(() => {
      scheduleUpdate()
    })

    const watchZoneControls = () => {
      zoneControlsObserver.disconnect()
      const controls = document.querySelectorAll<HTMLElement>('.ai-writer-floating-controls')
      for (const control of controls) {
        zoneControlsObserver.observe(control, {
          attributes: true,
          attributeFilter: ['style', 'class'],
        })
      }
    }
    watchZoneControls()

    const zoneControlsListObserver = new MutationObserver(() => {
      watchZoneControls()
      scheduleUpdate()
    })
    zoneControlsListObserver.observe(document.body, { childList: true, subtree: true })

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      floatingResizeObserver.disconnect()
      editorResizeObserver.disconnect()
      zoneControlsObserver.disconnect()
      zoneControlsListObserver.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
    }
  }, [view, activeSelection, prompt.length])

  useEffect(() => {
    if (!view || !activeSelection || !rootRef.current) return
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
  }, [view, activeSelection, setInteracting])

  if (!view || !activeSelection) return null

  return createPortal(
    <div
      ref={rootRef}
      className="ai-selection-toolbar data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-closed:slide-out-to-top-1 data-open:slide-in-from-bottom-1 data-closed:pointer-events-none fixed z-70 flex w-[min(94vw,420px)] flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md duration-150 dark:shadow-black/40 dark:ring-white/10"
      data-testid="ai-selection-toolbar"
      data-state={isVisible ? 'open' : 'closed'}
      aria-hidden={!isVisible}
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
          Edit selection
        </span>
      </div>

      <div className="p-2">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe what should change..."
          className="min-h-18 text-sm"
          disabled={isGenerating}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              handleSubmit()
            }
          }}
        />

        <div className="mt-2 flex items-center justify-between gap-2 px-1">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            Send with
            <Kbd>Ctrl/Cmd</Kbd>
            <Kbd>Enter</Kbd>
          </span>

          <Button size="xs" onClick={handleSubmit} disabled={!prompt.trim() || isGenerating}>
            {isGenerating ? (
              <Loader2 className="size-3 animate-spin" data-icon="inline-start" />
            ) : (
              <Pen className="size-3" data-icon="inline-start" />
            )}
            Rewrite
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function applyPosition(element: HTMLElement, x: number, y: number): void {
  element.style.left = `${Math.round(x)}px`
  element.style.top = `${Math.round(y)}px`
}

function getSelectionRect(view: EditorView, selection: SelectionRange): DOMRect {
  try {
    if (typeof window !== 'undefined') {
      const domSelection = window.getSelection()
      if (domSelection && domSelection.rangeCount > 0 && !domSelection.isCollapsed) {
        const range = domSelection.getRangeAt(0)
        if (view.dom.contains(range.commonAncestorContainer)) {
          const rect = range.getBoundingClientRect()
          if (rect.width > 0 || rect.height > 0) {
            return rect
          }
        }
      }
    }

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
