import { useMemo } from 'react'
import type { EditorView } from 'prosemirror-view'
import {
  AIZoneFloatingControl,
  SelectionComposeFloatingControl,
} from './inline-ai-desktop-controls'
import { useAIWriterState, useIsCoarsePointer } from './inline-ai-hooks'
import { MobileInlineAIDock } from './inline-ai-mobile-dock'
import type { LoadingAnchor, ReviewZone } from './inline-ai-types'
import type { SelectionRange } from './selection-types'

interface InlineAIControlsProps {
  view: EditorView | null
  selection: SelectionRange | null
  onGenerate: (prompt: string, selection: SelectionRange) => boolean
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
  onContinuePrompt: (zoneId: string, prompt: string) => boolean
  onDismissChoices: (zoneId: string) => boolean
  onInteractionChange: (interacting: boolean) => void
}

export function InlineAIControls({
  view,
  selection,
  onGenerate,
  onAccept,
  onReject,
  onContinuePrompt,
  onDismissChoices,
  onInteractionChange,
}: InlineAIControlsProps) {
  const state = useAIWriterState(view)
  const isCoarsePointer = useIsCoarsePointer()
  const hasSelection = Boolean(selection && selection.from < selection.to)

  const activeLoadingAnchor: LoadingAnchor | null = useMemo(() => {
    if (!state?.active || !state.streaming) return null

    const activeZone = state.zoneId ? state.zones.find((zone) => zone.id === state.zoneId) : null
    if (activeZone) {
      return {
        zoneId: activeZone.id,
        from: activeZone.from,
        to: activeZone.to,
        session: activeZone.session,
      }
    }

    const from = state.originalSelectionFrom ?? state.from
    const to = state.originalSelectionTo ?? state.to

    if (from === null || to === null) return null

    return {
      zoneId: state.zoneId ?? undefined,
      from: Math.min(from, to),
      to: Math.max(from, to),
      session: null,
    }
  }, [state])

  const loadingZoneId = activeLoadingAnchor?.zoneId ?? null

  const reviewZones: ReviewZone[] = useMemo(() => {
    if (!state) return []
    return state.zones.filter((zone) => zone.id !== loadingZoneId)
  }, [state, loadingZoneId])

  let activeReviewZone: ReviewZone | null = null
  if (!activeLoadingAnchor && reviewZones.length > 0) {
    if (state?.zoneId) {
      activeReviewZone = reviewZones.find((zone) => zone.id === state.zoneId) ?? null
    }
    if (!activeReviewZone) {
      activeReviewZone = reviewZones[reviewZones.length - 1] ?? null
    }
  }

  if (!view) return null

  if (isCoarsePointer) {
    return (
      <MobileInlineAIDock
        view={view}
        selection={selection}
        hasSelection={hasSelection}
        activeLoadingAnchor={activeLoadingAnchor}
        reviewZones={reviewZones}
        stuck={Boolean(state?.stuck)}
        onGenerate={onGenerate}
        onAccept={onAccept}
        onReject={onReject}
        onContinuePrompt={onContinuePrompt}
        onDismissChoices={onDismissChoices}
        onInteractionChange={onInteractionChange}
      />
    )
  }

  return (
    <>
      <SelectionComposeFloatingControl
        view={view}
        selection={selection}
        visible={hasSelection && !state?.active}
        onGenerate={onGenerate}
        onInteractionChange={onInteractionChange}
      />

      {activeLoadingAnchor ? (
        <AIZoneFloatingControl
          key={`loading-${activeLoadingAnchor.zoneId ?? `${activeLoadingAnchor.from}-${activeLoadingAnchor.to}`}`}
          view={view}
          zoneId={activeLoadingAnchor.zoneId}
          from={activeLoadingAnchor.from}
          to={activeLoadingAnchor.to}
          state="processing"
          stuck={Boolean(state?.stuck)}
          session={activeLoadingAnchor.session}
          onAccept={onAccept}
          onReject={onReject}
          onContinuePrompt={onContinuePrompt}
          onDismissChoices={onDismissChoices}
        />
      ) : null}

      {activeReviewZone ? (
        <AIZoneFloatingControl
          key={activeReviewZone.id}
          view={view}
          zoneId={activeReviewZone.id}
          from={activeReviewZone.from}
          to={activeReviewZone.to}
          state={activeReviewZone.streaming ? 'processing' : 'review'}
          stuck={false}
          session={activeReviewZone.session}
          onAccept={onAccept}
          onReject={onReject}
          onContinuePrompt={onContinuePrompt}
          onDismissChoices={onDismissChoices}
        />
      ) : null}
    </>
  )
}
