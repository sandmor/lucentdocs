import { useMemo } from 'react'
import type { EditorView } from 'prosemirror-view'
import { AIZoneFloatingControl, SelectionComposeFloatingControl } from './desktop-controls'
import { useAIWriterState, useIsCoarsePointer } from './hooks'
import { MobileInlineAIDock } from './mobile-dock'
import type { InlineZoneSession } from '@plotline/shared'
import type { ReviewZone } from './types'
import {
  resolveActiveLoadingAnchor,
  resolveActiveReviewZone,
  resolveReviewZones,
} from './state-selectors'
import type { SelectionRange } from '../selection/types'

interface InlineAIControlsProps {
  view: EditorView | null
  selection: SelectionRange | null
  onGenerate: (prompt: string, selection: SelectionRange) => boolean
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
  onStop: (zoneId?: string) => void
  onContinuePrompt: (zoneId: string, prompt: string) => boolean
  onDismissChoices: (zoneId: string) => boolean
  onInteractionChange: (interacting: boolean) => void
  sessionsById: Record<string, InlineZoneSession>
}

export function InlineAIControls({
  view,
  selection,
  onGenerate,
  onAccept,
  onReject,
  onStop,
  onContinuePrompt,
  onDismissChoices,
  onInteractionChange,
  sessionsById,
}: InlineAIControlsProps) {
  const state = useAIWriterState(view)
  const isCoarsePointer = useIsCoarsePointer()
  const hasSelection = Boolean(selection && selection.from < selection.to)

  const activeLoadingAnchor = useMemo(
    () => resolveActiveLoadingAnchor(state, sessionsById),
    [state, sessionsById]
  )

  const loadingZoneId = activeLoadingAnchor?.zoneId ?? null

  const reviewZones: ReviewZone[] = useMemo(() => {
    return resolveReviewZones(state, loadingZoneId, sessionsById)
  }, [state, loadingZoneId, sessionsById])

  const activeReviewZone = useMemo(
    () => resolveActiveReviewZone(state, activeLoadingAnchor, reviewZones),
    [state, activeLoadingAnchor, reviewZones]
  )

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
        onStop={onStop}
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
          onStop={onStop}
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
          onStop={onStop}
          onContinuePrompt={onContinuePrompt}
          onDismissChoices={onDismissChoices}
        />
      ) : null}
    </>
  )
}
