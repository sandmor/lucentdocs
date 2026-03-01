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
  onInteractionChange: (interacting: boolean) => void
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

  const reviewZones: ReviewZone[] = useMemo(() => {
    if (!state) return []
    return state.zones.filter((zone) => zone.id !== loadingZoneId)
  }, [state, loadingZoneId])

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
        onInteractionChange={onInteractionChange}
      />
    )
  }

  return (
    <>
      <SelectionComposeFloatingControl
        view={view}
        selection={selection}
        visible={hasSelection}
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
          mode={activeLoadingAnchor.mode}
          state="processing"
          choices={[]}
          stuck={Boolean(state?.stuck)}
          onAccept={onAccept}
          onReject={onReject}
        />
      ) : null}

      {reviewZones.map((zone) => (
        <AIZoneFloatingControl
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
