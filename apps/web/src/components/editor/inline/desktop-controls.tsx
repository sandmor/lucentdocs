import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom'
import type { InlineZoneSession } from '@lucentdocs/shared'
import { useAnimatedPresence, useMountAnimationPhase, useSelectionComposeController } from './hooks'
import { AI_ZONE_CONTROL_LAYOUT_EVENT, emitAIZoneControlLayoutChange } from './layout-events'
import { AIZoneSurface, SelectionComposeSurface } from './surfaces'
import type { InlineControlState } from './types'
import {
  applyPosition,
  COLLISION_PADDING,
  getSelectionRect,
  resolveCollisionPosition,
} from './utils'
import type { SelectionRange } from '../selection/types'
import type { EditorView } from 'prosemirror-view'

interface SelectionComposeFloatingControlProps {
  view: EditorView
  selection: SelectionRange | null
  visible: boolean
  onGenerate: (prompt: string, selection: SelectionRange) => boolean
  onInteractionChange: (interacting: boolean) => void
}

export function SelectionComposeFloatingControl({
  view,
  selection,
  visible,
  onGenerate,
  onInteractionChange,
}: SelectionComposeFloatingControlProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const presence = useAnimatedPresence(visible)

  const anchoredSelection = selection && selection.from < selection.to ? selection : null
  const controls = useSelectionComposeController(view, anchoredSelection, onGenerate)

  useEffect(() => {
    if (!presence.mounted || !anchoredSelection || !rootRef.current) return

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
      getBoundingClientRect: () => getSelectionRect(view, anchoredSelection),
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

    const handleZoneControlLayout = () => {
      scheduleUpdate()
    }

    window.addEventListener(AI_ZONE_CONTROL_LAYOUT_EVENT, handleZoneControlLayout)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      floatingResizeObserver.disconnect()
      editorResizeObserver.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
      window.removeEventListener(AI_ZONE_CONTROL_LAYOUT_EVENT, handleZoneControlLayout)
    }
  }, [view, anchoredSelection, controls.prompt.length, presence.mounted])

  if (!presence.mounted || !anchoredSelection) return null

  return createPortal(
    <SelectionComposeSurface
      rootRef={rootRef}
      className="ai-inline-controls ai-selection-toolbar ai-inline-animated ai-inline-animated-desktop fixed z-70 flex w-[min(94vw,420px)] flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md duration-150 dark:shadow-black/40 dark:ring-white/10"
      animationPhase={presence.phase}
      prompt={controls.prompt}
      markActive={controls.markActive}
      onPromptChange={controls.setPrompt}
      onToggleMark={controls.runToggleMark}
      onSubmit={controls.handleSubmit}
      onInteractionChange={onInteractionChange}
      showShortcutHint
    />,
    document.body
  )
}

interface AIZoneFloatingControlProps {
  view: EditorView
  zoneId?: string
  from: number
  to: number
  state: InlineControlState
  stuck: boolean
  session: InlineZoneSession | null
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
  onStop: (zoneId?: string) => void
  onContinuePrompt: (zoneId: string, prompt: string) => boolean
  onDismissChoices: (zoneId: string) => boolean
}

export function AIZoneFloatingControl({
  view,
  zoneId,
  from,
  to,
  state,
  stuck,
  session,
  onAccept,
  onReject,
  onStop,
  onContinuePrompt,
  onDismissChoices,
}: AIZoneFloatingControlProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fromRef = useRef(from)
  const toRef = useRef(to)
  const scheduleUpdateRef = useRef<(() => void) | null>(null)
  const animationPhase = useMountAnimationPhase()

  useEffect(() => {
    fromRef.current = from
    toRef.current = to
    scheduleUpdateRef.current?.()
  }, [from, to])

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
    let cancelled = false
    let rafId = 0
    let notifyLayoutRafId = 0
    let positionRequestId = 0

    const queueLayoutNotification = () => {
      if (cancelled || notifyLayoutRafId !== 0) return
      notifyLayoutRafId = requestAnimationFrame(() => {
        notifyLayoutRafId = 0
        if (!cancelled) {
          emitAIZoneControlLayoutChange()
        }
      })
    }

    const applyComputedPosition = (x: number, y: number) => {
      if (cancelled) return
      const roundedX = Math.round(x)
      const roundedY = Math.round(y)
      const nextLeft = `${roundedX}px`
      const nextTop = `${roundedY}px`

      if (el.style.left === nextLeft && el.style.top === nextTop) {
        return
      }

      el.style.left = nextLeft
      el.style.top = nextTop
      queueLayoutNotification()
    }

    const updatePosition = async () => {
      const anchorElement = getZoneAnchorElement()
      const requestId = ++positionRequestId

      if (anchorElement) {
        try {
          const result = await computePosition(anchorElement, el, {
            placement: 'bottom-start',
            middleware: [
              offset(8),
              flip({ fallbackAxisSideDirection: 'end' }),
              shift({ padding: 8 }),
            ],
          })
          if (cancelled || requestId !== positionRequestId) return
          applyComputedPosition(result.x, result.y)
        } catch {
          // ignore transient compute errors while the editor DOM is mutating
        }
        return
      }

      const docSize = view.state.doc.content.size
      const safeFrom = Math.max(0, Math.min(Math.min(fromRef.current, toRef.current), docSize))
      const safeTo = Math.max(0, Math.min(Math.max(fromRef.current, toRef.current), docSize))
      const fallbackPos = Math.max(0, Math.min(safeTo || safeFrom, docSize))
      const coords = view.coordsAtPos(fallbackPos)
      const virtualEl = {
        getBoundingClientRect: () =>
          new DOMRect(coords.left, coords.top, Math.max(1, coords.right - coords.left), 1),
      }

      try {
        const result = await computePosition(virtualEl, el, {
          placement: 'bottom-start',
          middleware: [
            offset(8),
            flip({ fallbackAxisSideDirection: 'end' }),
            shift({ padding: 8 }),
          ],
        })
        if (cancelled || requestId !== positionRequestId) return
        applyComputedPosition(result.x, result.y)
      } catch {
        // ignore transient compute errors while the editor DOM is mutating
      }
    }

    const scheduleUpdate = () => {
      if (cancelled) return
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        void updatePosition()
      })
    }

    scheduleUpdateRef.current = scheduleUpdate
    scheduleUpdate()
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(el)
    const cleanupAutoUpdate = autoUpdate(view.dom as HTMLElement, el, scheduleUpdate)

    return () => {
      cancelled = true
      scheduleUpdateRef.current = null
      cancelAnimationFrame(rafId)
      cancelAnimationFrame(notifyLayoutRafId)
      resizeObserver.disconnect()
      cleanupAutoUpdate()
      emitAIZoneControlLayoutChange()
    }
  }, [view, zoneId, getZoneAnchorElement])

  return createPortal(
    <AIZoneSurface
      rootRef={rootRef}
      className="ai-inline-controls ai-writer-floating-controls ai-inline-animated ai-inline-animated-desktop fixed z-60 flex min-w-0 w-[min(94vw,420px)] flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md dark:shadow-black/40 dark:ring-white/10"
      animationPhase={animationPhase}
      zoneId={zoneId}
      state={state}
      stuck={stuck}
      session={session}
      from={from}
      to={to}
      view={view}
      onAccept={onAccept}
      onReject={onReject}
      onStop={onStop}
      onContinuePrompt={onContinuePrompt}
      onDismissChoices={onDismissChoices}
    />,
    document.body
  )
}
