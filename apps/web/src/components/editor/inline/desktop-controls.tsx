import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom'
import type { InlineZoneSession } from '@lucentdocs/shared'
import type { InlineSessionPreview } from './inline-session-preview'
import { useAnimatedPresence, useMountAnimationPhase, useSelectionComposeController } from './hooks'
import { AI_ZONE_CONTROL_LAYOUT_EVENT, emitAIZoneControlLayoutChange } from './layout-events'
import { AIZoneSurface, SelectionComposeSurface } from './surfaces'
import type { InlineControlState } from './types'
import {
  clampSideElementToViewport,
  computeLeftGutterViewportX,
  getEditorContentRect,
} from '../side-elements/layout'
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

  const portalTarget = document.body

  if (!presence.mounted || !anchoredSelection) return null

  return createPortal(
    <SelectionComposeSurface
      rootRef={rootRef}
      className="ai-inline-controls ai-selection-toolbar ai-inline-animated ai-inline-animated-desktop fixed z-40 flex overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md duration-150 dark:shadow-black/40 dark:ring-white/10"
      animationPhase={presence.phase}
      selectionKey={controls.selectionKey}
      prompt={controls.prompt}
      markActive={controls.markActive}
      formatEnabled={controls.formatEnabled}
      onPromptChange={controls.setPrompt}
      onToggleMark={controls.runToggleMark}
      onSubmit={controls.handleSubmit}
      onInteractionChange={onInteractionChange}
      showShortcutHint
    />,
    portalTarget
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
  sessionPreview?: InlineSessionPreview | null
  serverGenerating?: boolean
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
  onStop: (zoneId?: string) => void
  onContinuePrompt: (zoneId: string, prompt: string) => boolean
  onDismissChoices: (zoneId: string) => boolean
  onUndoTurn?: (zoneId: string) => void
  onRedoTurn?: (zoneId: string) => void
  onInteractionChange?: (interacting: boolean) => void
  suggestedByLabel?: string | null
}

export function AIZoneFloatingControl({
  view,
  zoneId,
  from,
  to,
  state,
  stuck,
  session,
  sessionPreview = null,
  serverGenerating = false,
  onAccept,
  onReject,
  onStop,
  onContinuePrompt,
  onDismissChoices,
  onUndoTurn,
  onRedoTurn,
  onInteractionChange,
  suggestedByLabel,
}: AIZoneFloatingControlProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const fromRef = useRef(from)
  const toRef = useRef(to)
  const scheduleUpdateRef = useRef<(() => void) | null>(null)
  const animationPhase = useMountAnimationPhase()

  useEffect(() => {
    fromRef.current = from
    toRef.current = to
    scheduleUpdateRef.current?.()
  }, [from, to])

  const getZoneAnchorRect = useCallback((): DOMRect | null => {
    if (!zoneId) return null

    const escapedId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(zoneId)
        : zoneId.replace(/["\\]/g, '\\$&')

    const matches = Array.from(
      view.dom.querySelectorAll<HTMLElement>(`.ai-generating-text[data-ai-zone-id="${escapedId}"]`)
    )

    let zoneTop: number
    let zoneBottom: number
    let zoneLeft: number
    let zoneRight: number

    if (matches.length > 0) {
      const firstRect = matches[0].getBoundingClientRect()
      const lastRect = matches[matches.length - 1].getBoundingClientRect()
      zoneTop = firstRect.top
      zoneBottom = lastRect.bottom
      zoneLeft = Math.min(...matches.map((m) => m.getBoundingClientRect().left))
      zoneRight = Math.max(...matches.map((m) => m.getBoundingClientRect().right))
    } else {
      const docSize = view.state.doc.content.size
      const safeFrom = Math.max(0, Math.min(Math.min(fromRef.current, toRef.current), docSize))
      const safeTo = Math.max(0, Math.min(Math.max(fromRef.current, toRef.current), docSize))
      const fallbackPos = Math.max(0, Math.min(safeTo || safeFrom, docSize))
      try {
        const fromCoords = view.coordsAtPos(safeFrom)
        const toCoords = view.coordsAtPos(fallbackPos)
        zoneTop = fromCoords.top
        zoneBottom = toCoords.bottom
        zoneLeft = Math.min(fromCoords.left, toCoords.left)
        zoneRight = Math.max(fromCoords.right, toCoords.right)
      } catch {
        return null
      }
    }

    const scrollContainer = view.dom.closest('main')
    let viewportTop = 0
    let viewportBottom = window.innerHeight

    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect()
      viewportTop = containerRect.top
      viewportBottom = containerRect.bottom
    }

    let floatingHeight = 64
    if (rootRef.current) {
      const h = rootRef.current.getBoundingClientRect().height
      if (h > 0) floatingHeight = h
    }

    const screenCenterY = (viewportTop + viewportBottom) / 2
    const targetAnchorY = screenCenterY - 8 - floatingHeight / 2

    const minAnchorY = zoneTop - 8
    const maxAnchorY = zoneBottom - 8 - floatingHeight

    let anchorY = targetAnchorY

    if (minAnchorY <= maxAnchorY) {
      anchorY = Math.max(minAnchorY, Math.min(maxAnchorY, targetAnchorY))
    } else {
      anchorY = zoneBottom
    }

    return new DOMRect(zoneLeft, anchorY, Math.max(1, zoneRight - zoneLeft), 1)
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
      applyPosition(el, x, y)
      queueLayoutNotification()
    }

    const updatePosition = async () => {
      const anchorRect = getZoneAnchorRect()
      const requestId = ++positionRequestId

      if (anchorRect) {
        if (isMinimized) {
          const editorRect = getEditorContentRect(view)
          const rect = el.getBoundingClientRect()
          const width = Math.max(rect.width, el.offsetWidth, 40)
          const height = Math.max(rect.height, el.offsetHeight, 40)
          const x = computeLeftGutterViewportX(editorRect, width)
          const y = anchorRect.y + 8
          const clamped = clampSideElementToViewport(x, y, width, height)
          if (cancelled || requestId !== positionRequestId) return
          applyComputedPosition(clamped.x, clamped.y)
          return
        }

        const virtualEl = {
          getBoundingClientRect: () => anchorRect,
          contextElement: view.dom as HTMLElement,
        }

        try {
          const result = await computePosition(virtualEl, el, {
            placement: 'bottom-start',
            middleware: [
              offset({ mainAxis: 8 }),
              shift({ padding: 8, crossAxis: true }),
              {
                name: 'forceY',
                fn(state) {
                  return { y: state.rects.reference.y + 8 }
                },
              },
            ],
          })
          if (cancelled || requestId !== positionRequestId) return
          applyComputedPosition(result.x, result.y)
        } catch {
          // ignore transient compute errors while the editor DOM is mutating
        }
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
  }, [view, zoneId, getZoneAnchorRect, isMinimized])

  const portalTarget = document.body

  return createPortal(
    <AIZoneSurface
      rootRef={rootRef}
      className={`ai-inline-controls ai-writer-floating-controls ai-inline-animated ai-inline-animated-desktop fixed z-40 flex overflow-hidden border border-border bg-background/95 shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md dark:shadow-black/40 dark:ring-white/10 ${
        isMinimized
          ? 'w-10 h-10 rounded-full items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors'
          : 'min-w-0 w-[min(94vw,420px)] flex-col rounded-xl font-sans text-[13px]'
      }`}
      isMinimized={isMinimized}
      onToggleMinimize={() => setIsMinimized((v) => !v)}
      animationPhase={animationPhase}
      zoneId={zoneId}
      state={state}
      stuck={stuck}
      session={session}
      sessionPreview={sessionPreview}
      serverGenerating={serverGenerating}
      from={from}
      to={to}
      view={view}
      onAccept={onAccept}
      onReject={onReject}
      onStop={onStop}
      onContinuePrompt={onContinuePrompt}
      onDismissChoices={onDismissChoices}
      onUndoTurn={onUndoTurn}
      onRedoTurn={onRedoTurn}
      onInteractionChange={onInteractionChange}
      suggestedByLabel={suggestedByLabel}
    />,
    portalTarget
  )
}
