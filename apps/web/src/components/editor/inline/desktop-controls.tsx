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
  applyPosition,
  COLLISION_PADDING,
  getSelectionRect,
  resolveCollisionPosition,
} from './utils'
import type { SelectionRange } from '../selection/types'
import type { EditorView } from 'prosemirror-view'
import {
  AI_ZONE_VIEWPORT_PADDING,
  getOffscreenDirection,
  placeAIZoneCard,
  rect,
  type AIZoneOffscreenDirection,
  type AIZonePlacement,
} from './ai-zone-placement'

function getAIZoneViewport(view: EditorView): DOMRect {
  const main = view.dom.closest('main')?.getBoundingClientRect()
  const viewport = new DOMRect(0, 0, window.innerWidth, window.innerHeight)
  if (!main) return viewport
  const left = Math.max(viewport.left, main.left) + AI_ZONE_VIEWPORT_PADDING
  const top = Math.max(viewport.top, main.top) + AI_ZONE_VIEWPORT_PADDING
  const right = Math.min(viewport.right, main.right) - AI_ZONE_VIEWPORT_PADDING
  const bottom = Math.min(viewport.bottom, main.bottom) - AI_ZONE_VIEWPORT_PADDING
  return new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top))
}

function floatingObstacles(exclude: HTMLElement): ReturnType<typeof rect>[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-editor-floating-obstacle="true"]')
  )
    .filter((element) => element !== exclude)
    .map((element) => element.getBoundingClientRect())
    .filter((bounds) => bounds.width > 0 && bounds.height > 0)
    .map((bounds) => rect(bounds.left, bounds.top, bounds.width, bounds.height))
}

interface SelectionComposeFloatingControlProps {
  view: EditorView
  selection: SelectionRange | null
  visible: boolean
  onGenerate: (prompt: string, selection: SelectionRange) => boolean
  onConvertSelectionToMath: (selection: SelectionRange) => boolean
  onInteractionChange: (interacting: boolean) => void
}

export function SelectionComposeFloatingControl({
  view,
  selection,
  visible,
  onGenerate,
  onConvertSelectionToMath,
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
      onInsertMath={() => {
        if (anchoredSelection) onConvertSelectionToMath(anchoredSelection)
      }}
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
  initialMinimized?: boolean
  zoneOrdinal?: number
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
  initialMinimized = false,
  zoneOrdinal,
}: AIZoneFloatingControlProps) {
  const rootRef = useRef<HTMLElement>(null)
  const [isMinimized, setIsMinimized] = useState(initialMinimized)
  const [offscreenDirection, setOffscreenDirection] = useState<AIZoneOffscreenDirection>(null)
  const [lockedSide, setLockedSide] = useState<AIZonePlacement['side'] | null>(null)
  const [marker, setMarker] = useState<{
    x: number
    y: number
    side: AIZonePlacement['side']
  } | null>(null)
  const fromRef = useRef(from)
  const toRef = useRef(to)
  const scheduleUpdateRef = useRef<(() => void) | null>(null)
  const animationPhase = useMountAnimationPhase()

  useEffect(() => {
    fromRef.current = from
    toRef.current = to
    scheduleUpdateRef.current?.()
  }, [from, to])

  useEffect(() => {
    if (!zoneId) return
    const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(zoneId) : zoneId
    const matches = Array.from(
      view.dom.querySelectorAll<HTMLElement>(`.ai-generating-text[data-ai-zone-id="${escapedId}"]`)
    )
    for (const match of matches) match.dataset.aiZoneControlActive = 'true'
    return () => {
      for (const match of matches) delete match.dataset.aiZoneControlActive
    }
  }, [view, zoneId])

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

    return new DOMRect(
      zoneLeft,
      zoneTop,
      Math.max(1, zoneRight - zoneLeft),
      Math.max(1, zoneBottom - zoneTop)
    )
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
      const left = `${Math.round(x)}px`
      const top = `${Math.round(y)}px`
      if (el.style.left !== left) el.style.left = left
      if (el.style.top !== top) el.style.top = top
      queueLayoutNotification()
    }

    const updatePosition = async () => {
      const anchorRect = getZoneAnchorRect()
      const requestId = ++positionRequestId

      if (!anchorRect) return

      const viewport = getAIZoneViewport(view)
      const anchor = rect(anchorRect.left, anchorRect.top, anchorRect.width, anchorRect.height)
      const nextOffscreenDirection = getOffscreenDirection(
        anchor,
        rect(viewport.left, viewport.top, viewport.width, viewport.height),
        offscreenDirection ? 24 : 8
      )
      setOffscreenDirection((current) =>
        current === nextOffscreenDirection ? current : nextOffscreenDirection
      )

      const compact = isMinimized || nextOffscreenDirection !== null
      const bounds = el.getBoundingClientRect()
      const width = Math.max(bounds.width, el.offsetWidth, compact ? 40 : 1)
      const height = Math.max(bounds.height, el.offsetHeight, compact ? 40 : 1)
      const editorRect = view.dom.getBoundingClientRect()
      const nextPlacement = placeAIZoneCard({
        anchor,
        viewport: rect(viewport.left, viewport.top, viewport.width, viewport.height),
        editor: rect(editorRect.left, editorRect.top, editorRect.width, editorRect.height),
        width,
        height,
        obstacles: floatingObstacles(el),
        preferredSide: lockedSide,
      })
      const y =
        compact && nextOffscreenDirection
          ? nextOffscreenDirection === 'above'
            ? viewport.top
            : viewport.bottom - height
          : nextPlacement.y
      if (cancelled || requestId !== positionRequestId) return
      el.style.maxHeight = `${Math.round(viewport.height)}px`
      setLockedSide((current) => current ?? nextPlacement.side)
      const markerSide = lockedSide ?? nextPlacement.side
      setMarker({
        side: markerSide,
        x: markerSide === 'right' ? editorRect.right + 4 : editorRect.left - 24,
        y: Math.round(Math.min(Math.max(anchorRect.top, viewport.top), viewport.bottom - 20)),
      })
      applyComputedPosition(nextPlacement.x, y)
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
    const resizeObserver = new ResizeObserver(() => {
      if (el.dataset.aiZoneMorphing === 'true') return
      scheduleUpdate()
    })
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
  }, [view, zoneId, getZoneAnchorRect, isMinimized, offscreenDirection, lockedSide])

  const portalTarget = document.body

  const handleToggleMinimize = () => {
    if (offscreenDirection) {
      const escapedId =
        zoneId && typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(zoneId) : zoneId
      const zone = escapedId
        ? view.dom.querySelector<HTMLElement>(`.ai-generating-text[data-ai-zone-id="${escapedId}"]`)
        : null
      zone?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setIsMinimized(false)
      return
    }
    setIsMinimized((value) => !value)
  }

  return createPortal(
    <>
      {marker && !isMinimized && !offscreenDirection ? (
        <button
          type="button"
          className="fixed z-40 flex size-5 items-center justify-center rounded-full border border-primary/35 bg-background/95 text-[10px] font-semibold text-primary shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: `${Math.round(marker.x)}px`, top: `${Math.round(marker.y)}px` }}
          aria-label={`Focus AI Zone ${zoneOrdinal ?? ''}`.trim()}
          title={`AI Zone ${zoneOrdinal ?? ''}`.trim()}
          onClick={() => rootRef.current?.focus()}
        >
          {zoneOrdinal ?? '•'}
        </button>
      ) : null}
      <AIZoneSurface
        rootRef={rootRef}
        className={`ai-inline-controls ai-writer-floating-controls ai-zone-control-card fixed z-40 flex overflow-hidden border bg-background/95 backdrop-blur-md ${
          isMinimized || offscreenDirection !== null
            ? 'items-center justify-center cursor-pointer hover:bg-muted/50'
            : `min-w-0 flex-col ${lockedSide === 'left' ? 'border-r-2' : 'border-l-2'} border-primary/30 font-sans text-[13px]`
        }`}
        isMinimized={isMinimized || offscreenDirection !== null}
        onToggleMinimize={handleToggleMinimize}
        offscreenDirection={offscreenDirection}
        zoneOrdinal={zoneOrdinal}
        onMorphStart={() => {
          if (rootRef.current) rootRef.current.dataset.aiZoneMorphing = 'true'
        }}
        onMorphComplete={() => {
          if (rootRef.current) delete rootRef.current.dataset.aiZoneMorphing
          scheduleUpdateRef.current?.()
        }}
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
      />
    </>,
    portalTarget
  )
}
