import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { EditorView } from 'prosemirror-view'
import { Button } from '@/components/ui/button'
import {
  useAnimatedPresence,
  useSelectionComposeController,
  useVisualViewportBottomOffset,
} from './hooks'
import { AIZoneSurface, SelectionComposeSurface } from './surfaces'
import type { LoadingAnchor, ReviewZone } from './types'
import type { SelectionRange } from '../selection/types'

interface MobileInlineAIDockProps {
  view: EditorView
  selection: SelectionRange | null
  hasSelection: boolean
  activeLoadingAnchor: LoadingAnchor | null
  reviewZones: ReviewZone[]
  stuck: boolean
  onGenerate: (prompt: string, selection: SelectionRange) => boolean
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
  onContinuePrompt: (zoneId: string, prompt: string) => boolean
  onDismissChoices: (zoneId: string) => boolean
  onInteractionChange: (interacting: boolean) => void
}

function setDockLayoutVariables(offset: number, reserve: number): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--ai-inline-mobile-dock-offset', `${Math.max(0, Math.round(offset))}px`)
  root.style.setProperty('--ai-inline-mobile-dock-reserve', `${Math.max(0, Math.round(reserve))}px`)
}

export function MobileInlineAIDock({
  view,
  selection,
  hasSelection,
  activeLoadingAnchor,
  reviewZones,
  stuck,
  onGenerate,
  onAccept,
  onReject,
  onContinuePrompt,
  onDismissChoices,
  onInteractionChange,
}: MobileInlineAIDockProps) {
  const dockRef = useRef<HTMLDivElement>(null)
  const selectionRootRef = useRef<HTMLDivElement>(null)
  const viewportBottomOffset = useVisualViewportBottomOffset(true)
  const [activeReviewZoneId, setActiveReviewZoneId] = useState<string | null>(null)

  const selectionControls = useSelectionComposeController(
    view,
    hasSelection ? selection : null,
    onGenerate
  )

  const resolvedReviewZoneId = useMemo(() => {
    if (!activeReviewZoneId) return null
    return reviewZones.some((zone) => zone.id === activeReviewZoneId) ? activeReviewZoneId : null
  }, [activeReviewZoneId, reviewZones])

  const activeReviewZone = useMemo(() => {
    if (reviewZones.length === 0) return null
    if (!resolvedReviewZoneId) return reviewZones[reviewZones.length - 1] ?? null
    return (
      reviewZones.find((zone) => zone.id === resolvedReviewZoneId) ??
      reviewZones[reviewZones.length - 1] ??
      null
    )
  }, [reviewZones, resolvedReviewZoneId])

  const activeReviewIndex = useMemo(() => {
    if (!activeReviewZone) return -1
    return reviewZones.findIndex((zone) => zone.id === activeReviewZone.id)
  }, [reviewZones, activeReviewZone])

  const activeMode = useMemo(() => {
    if (hasSelection && selection) {
      return {
        kind: 'selection' as const,
      }
    }

    if (activeLoadingAnchor) {
      return {
        kind: 'loading' as const,
        zone: activeLoadingAnchor,
      }
    }

    if (activeReviewZone) {
      return {
        kind: 'review' as const,
        zone: activeReviewZone,
      }
    }

    return null
  }, [activeLoadingAnchor, activeReviewZone, hasSelection, selection])

  const presence = useAnimatedPresence(Boolean(activeMode))

  useEffect(() => {
    if (!presence.mounted || !dockRef.current) {
      setDockLayoutVariables(0, 0)
      return
    }

    const dockEl = dockRef.current
    let rafId = 0

    const updateDockLayout = () => {
      const dockHeight = Math.max(0, Math.round(dockEl.getBoundingClientRect().height))
      const offset = Math.max(0, viewportBottomOffset)
      setDockLayoutVariables(offset, dockHeight + offset)
    }

    const scheduleDockLayoutUpdate = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateDockLayout)
    }

    scheduleDockLayoutUpdate()

    const resizeObserver = new ResizeObserver(scheduleDockLayoutUpdate)
    resizeObserver.observe(dockEl)
    window.addEventListener('resize', scheduleDockLayoutUpdate)

    return () => {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleDockLayoutUpdate)
    }
  }, [presence.mounted, viewportBottomOffset])

  useEffect(() => {
    return () => {
      setDockLayoutVariables(0, 0)
    }
  }, [])

  const moveReviewSelection = useCallback(
    (direction: -1 | 1) => {
      if (reviewZones.length <= 1 || activeReviewIndex < 0) return

      const nextIndex = (activeReviewIndex + direction + reviewZones.length) % reviewZones.length
      const nextZone = reviewZones[nextIndex]
      if (!nextZone) return
      setActiveReviewZoneId(nextZone.id)
    },
    [activeReviewIndex, reviewZones]
  )

  if (!presence.mounted || !activeMode) return null

  return createPortal(
    <div
      className="ai-inline-mobile-dock ai-inline-animated-dock"
      data-ai-phase={presence.phase}
      ref={dockRef}
    >
      <div className="ai-inline-mobile-dock__inner">
        {activeMode.kind === 'review' && reviewZones.length > 1 ? (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-border bg-background/95 px-2 py-1 text-[11px] text-muted-foreground shadow-md shadow-black/5 backdrop-blur-md dark:shadow-black/40">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title="Previous AI zone"
              onClick={() => moveReviewSelection(-1)}
            >
              <ChevronLeft className="size-3" />
            </Button>
            <span>
              Zone {activeReviewIndex + 1} of {reviewZones.length}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title="Next AI zone"
              onClick={() => moveReviewSelection(1)}
            >
              <ChevronRight className="size-3" />
            </Button>
          </div>
        ) : null}

        {activeMode.kind === 'selection' ? (
          <SelectionComposeSurface
            rootRef={selectionRootRef}
            className="ai-inline-controls ai-selection-toolbar ai-inline-animated ai-inline-animated-mobile ai-inline-mobile-panel flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md dark:shadow-black/40 dark:ring-white/10"
            animationPhase={presence.phase}
            prompt={selectionControls.prompt}
            markActive={selectionControls.markActive}
            onPromptChange={selectionControls.setPrompt}
            onToggleMark={selectionControls.runToggleMark}
            onSubmit={selectionControls.handleSubmit}
            onInteractionChange={onInteractionChange}
            showShortcutHint={false}
          />
        ) : null}

        {activeMode.kind === 'loading' ? (
          <AIZoneSurface
            rootRef={null}
            className="ai-inline-controls ai-writer-floating-controls ai-inline-animated ai-inline-animated-mobile ai-inline-mobile-panel flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md dark:shadow-black/40 dark:ring-white/10"
            animationPhase={presence.phase}
            zoneId={activeMode.zone.zoneId}
            state="processing"
            stuck={stuck}
            session={activeMode.zone.session}
            from={activeMode.zone.from}
            to={activeMode.zone.to}
            view={view}
            onAccept={onAccept}
            onReject={onReject}
            onContinuePrompt={onContinuePrompt}
            onDismissChoices={onDismissChoices}
          />
        ) : null}

        {activeMode.kind === 'review' ? (
          <AIZoneSurface
            rootRef={null}
            className="ai-inline-controls ai-writer-floating-controls ai-inline-animated ai-inline-animated-mobile ai-inline-mobile-panel flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans text-[13px] shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md dark:shadow-black/40 dark:ring-white/10"
            animationPhase={presence.phase}
            zoneId={activeMode.zone.id}
            state={activeMode.zone.streaming ? 'processing' : 'review'}
            stuck={false}
            session={activeMode.zone.session}
            from={activeMode.zone.from}
            to={activeMode.zone.to}
            view={view}
            onAccept={onAccept}
            onReject={onReject}
            onContinuePrompt={onContinuePrompt}
            onDismissChoices={onDismissChoices}
          />
        ) : null}
      </div>
    </div>,
    document.body
  )
}
