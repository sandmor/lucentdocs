import { useMemo } from 'react'
import type { EditorView } from 'prosemirror-view'
import { AIZoneFloatingControl, SelectionComposeFloatingControl } from './desktop-controls'
import { useAIWriterState, useIsCoarsePointer } from './hooks'
import { MobileInlineAIDock } from './mobile-dock'

import type { ReviewZone } from './types'
import {
  resolveActiveLoadingAnchor,
  resolveActiveReviewZone,
  resolveReviewZones,
} from './state-selectors'
import type { SelectionRange } from '../selection/types'
import { useEditorStore } from '@/lib/editor-store'
import { shouldShowSelectionCompose } from './utils'

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
}: InlineAIControlsProps) {
  const state = useAIWriterState(view)
  const sessionsById = useEditorStore((s) => s.inlineSessionsById)
  const sessionPreviewsById = useEditorStore((s) => s.inlineSessionPreviewById)
  const sessionStreamMetaById = useEditorStore((s) => s.inlineSessionStreamMetaById)
  const isCoarsePointer = useIsCoarsePointer()
  const hasSelection = Boolean(selection && selection.from < selection.to)
  const showSelectionCompose = Boolean(
    view && hasSelection && shouldShowSelectionCompose(view, selection)
  )

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
        showSelectionCompose={showSelectionCompose}
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
        visible={showSelectionCompose && !state?.active}
        onGenerate={onGenerate}
        onInteractionChange={onInteractionChange}
      />

      {(() => {
        const activeZone = activeLoadingAnchor
          ? {
              key:
                activeLoadingAnchor.zoneId ??
                `loading-${activeLoadingAnchor.from}-${activeLoadingAnchor.to}`,
              zoneId: activeLoadingAnchor.zoneId,
              sessionId: activeLoadingAnchor.sessionId,
              from: activeLoadingAnchor.from,
              to: activeLoadingAnchor.to,
              state: 'processing' as const,
              stuck: Boolean(state?.stuck),
              session: activeLoadingAnchor.session,
            }
          : activeReviewZone
            ? {
                key: activeReviewZone.id,
                zoneId: activeReviewZone.id,
                sessionId: activeReviewZone.sessionId,
                from: activeReviewZone.from,
                to: activeReviewZone.to,
                state: activeReviewZone.streaming ? ('processing' as const) : ('review' as const),
                stuck: false,
                session: activeReviewZone.session,
              }
            : null

        if (!activeZone) return null

        const sessionId = activeZone.sessionId ?? null
        const serverGenerating = sessionId
          ? Boolean(sessionStreamMetaById[sessionId]?.generating)
          : false

        return (
          <AIZoneFloatingControl
            key={activeZone.key}
            view={view}
            zoneId={activeZone.zoneId}
            from={activeZone.from}
            to={activeZone.to}
            state={activeZone.state}
            stuck={activeZone.stuck}
            session={activeZone.session}
            sessionPreview={sessionId ? (sessionPreviewsById[sessionId] ?? null) : null}
            serverGenerating={serverGenerating}
            onAccept={onAccept}
            onReject={onReject}
            onStop={onStop}
            onContinuePrompt={onContinuePrompt}
            onDismissChoices={onDismissChoices}
          />
        )
      })()}
    </>
  )
}
