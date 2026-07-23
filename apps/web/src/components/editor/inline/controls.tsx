import { useMemo } from 'react'
import type { EditorView } from 'prosemirror-view'
import type * as Y from 'yjs'
import type { InlineZoneSession } from '@lucentdocs/shared'
import { AIZoneFloatingControl, SelectionComposeFloatingControl } from './desktop-controls'
import { useAIWriterState, useIsCoarsePointer } from './hooks'
import { MobileInlineAIDock } from './mobile-dock'
import { RestoreSuggestionChip } from './restore-suggestion-chip'

import type { ReviewZone } from './types'
import { resolveActiveLoadingAnchor, resolveReviewZones } from './state-selectors'
import type { SelectionRange } from '../selection/types'
import { useEditorStore } from '@/lib/editor-store'
import { shouldShowSelectionCompose } from './utils'

function resolveSuggestedByLabel(
  session: InlineZoneSession | null,
  localClientName: string | null,
  getCollaboratorDisplayName: (clientName: string | null | undefined) => string
): string | null {
  if (!session?.lastRequesterClientName) return null
  if (localClientName && session.lastRequesterClientName === localClientName) {
    return 'Suggested by you'
  }
  return `Suggested by ${getCollaboratorDisplayName(session.lastRequesterClientName)}`
}

interface InlineAIControlsProps {
  view: EditorView | null
  selection: SelectionRange | null
  onGenerate: (prompt: string, selection: SelectionRange) => boolean
  onConvertSelectionToMath: (selection: SelectionRange) => boolean
  onAccept: (zoneId?: string) => void
  onReject: (zoneId?: string) => void
  onStop: (zoneId?: string) => void
  onContinuePrompt: (zoneId: string, prompt: string) => boolean
  onDismissChoices: (zoneId: string) => boolean
  onUndoTurn: (zoneId: string) => void
  onRedoTurn: (zoneId: string) => void
  onRestoreAcceptedSession: (sessionId: string) => void
  onInteractionChange: (interacting: boolean) => void
  onInlineAIInteractionChange: (interacting: boolean) => void
  getCollaboratorDisplayName: (clientName: string | null | undefined) => string
  getLocalClientName: () => string | null
  mobileBlockBarInteracting: boolean
  onBlockBarInteractionChange: (interacting: boolean) => void
  notesMap?: Y.Map<unknown> | null
  currentUserId?: string
  onNoteCreated?: (noteId: string, anchorId: string) => void
}

export function InlineAIControls({
  view,
  selection,
  onGenerate,
  onConvertSelectionToMath,
  onAccept,
  onReject,
  onStop,
  onContinuePrompt,
  onDismissChoices,
  onUndoTurn,
  onRedoTurn,
  onRestoreAcceptedSession,
  onInteractionChange,
  onInlineAIInteractionChange,
  getCollaboratorDisplayName,
  getLocalClientName,
  mobileBlockBarInteracting,
  onBlockBarInteractionChange,
  notesMap,
  currentUserId,
  onNoteCreated,
}: InlineAIControlsProps) {
  const state = useAIWriterState(view)
  const sessionsById = useEditorStore((s) => s.inlineSessionsById)
  const dismissedRestoreSessionIds = useEditorStore((s) => s.dismissedRestoreSessionIds)
  const dismissRestoreSuggestion = useEditorStore((s) => s.dismissRestoreSuggestion)
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

  const desktopZones = useMemo(() => {
    const zones = new Map<
      string,
      {
        key: string
        zoneId?: string
        sessionId?: string | null
        from: number
        to: number
        state: 'processing' | 'review'
        stuck: boolean
        session: InlineZoneSession | null
      }
    >()

    const add = (zone: {
      zoneId?: string
      sessionId?: string | null
      from: number
      to: number
      state: 'processing' | 'review'
      stuck: boolean
      session: InlineZoneSession | null
    }) => {
      // Keep a stream's control mounted while its temporary range gains a
      // canonical zone id; otherwise it briefly duplicates during creation.
      const key = zone.sessionId ?? zone.zoneId ?? `loading-${zone.from}-${zone.to}`
      const current = zones.get(key)
      if (!current || zone.state === 'processing') zones.set(key, { ...zone, key })
    }

    if (activeLoadingAnchor) {
      add({
        zoneId: activeLoadingAnchor.zoneId,
        sessionId: activeLoadingAnchor.sessionId,
        from: activeLoadingAnchor.from,
        to: activeLoadingAnchor.to,
        state: 'processing',
        stuck: Boolean(state?.stuck),
        session: activeLoadingAnchor.session,
      })
    }

    for (const zone of reviewZones) {
      add({
        zoneId: zone.id,
        sessionId: zone.sessionId,
        from: zone.from,
        to: zone.to,
        state: zone.streaming ? 'processing' : 'review',
        stuck: false,
        session: zone.session,
      })
    }

    return [...zones.values()].sort((left, right) => left.from - right.from)
  }, [activeLoadingAnchor, reviewZones, state?.stuck])

  const localClientName = getLocalClientName()

  const restorableSessions = useMemo(() => {
    if (!view) return []
    const liveSessionIds = new Set(
      (state?.zones ?? [])
        .map((zone) => zone.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId))
    )

    return Object.entries(sessionsById).flatMap(([sessionId, session]) => {
      if ((session.turnCheckpoints?.length ?? 0) === 0) return []
      if (liveSessionIds.has(sessionId)) return []
      if (dismissedRestoreSessionIds[sessionId]) return []
      return [{ sessionId, session }]
    })
  }, [dismissedRestoreSessionIds, sessionsById, state?.zones, view])

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
        onConvertSelectionToMath={onConvertSelectionToMath}
        onAccept={onAccept}
        onReject={onReject}
        onStop={onStop}
        onContinuePrompt={onContinuePrompt}
        onDismissChoices={onDismissChoices}
        onUndoTurn={onUndoTurn}
        onRedoTurn={onRedoTurn}
        onInteractionChange={onInteractionChange}
        onInlineAIInteractionChange={onInlineAIInteractionChange}
        getCollaboratorDisplayName={getCollaboratorDisplayName}
        getLocalClientName={getLocalClientName}
        mobileBlockBarInteracting={mobileBlockBarInteracting}
        onBlockBarInteractionChange={onBlockBarInteractionChange}
        notesMap={notesMap}
        currentUserId={currentUserId}
        onNoteCreated={onNoteCreated}
      />
    )
  }

  return (
    <>
      {restorableSessions.map(({ sessionId, session }) => (
        <RestoreSuggestionChip
          key={`restore-${sessionId}`}
          view={view}
          sessionId={sessionId}
          session={session}
          onRestore={onRestoreAcceptedSession}
          onDismiss={dismissRestoreSuggestion}
        />
      ))}

      <SelectionComposeFloatingControl
        view={view}
        selection={selection}
        visible={showSelectionCompose && !state?.active}
        onGenerate={onGenerate}
        onConvertSelectionToMath={onConvertSelectionToMath}
        onInteractionChange={onInteractionChange}
      />

      {desktopZones.map((activeZone, index) => {
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
            initialMinimized={activeZone.state !== 'processing'}
            zoneOrdinal={index + 1}
            onAccept={onAccept}
            onReject={onReject}
            onStop={onStop}
            onContinuePrompt={onContinuePrompt}
            onDismissChoices={onDismissChoices}
            onUndoTurn={onUndoTurn}
            onRedoTurn={onRedoTurn}
            onInteractionChange={onInlineAIInteractionChange}
            suggestedByLabel={resolveSuggestedByLabel(
              activeZone.session,
              localClientName,
              getCollaboratorDisplayName
            )}
          />
        )
      })}
    </>
  )
}
