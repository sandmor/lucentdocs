import type { InlineZoneSession } from '@lucentdocs/shared'
import type { InlineSessionStreamMeta } from '@/lib/editor-store'

export interface InlineObserveSnapshotLike {
  type: 'snapshot'
  sessionId: string
  seq: number
  session: InlineZoneSession | null
  generating: boolean
  generationId: string | null
  draftText?: string | null
  error?: string | null
}

export interface InlineObserveSnapshotEffects {
  session: InlineZoneSession | null
  streamMeta: InlineSessionStreamMeta | null
  clearPreview: boolean
  settleGeneration?: {
    generationId: string
    error?: string
  }
}

export function effectsFromInlineSnapshot(
  event: InlineObserveSnapshotLike
): InlineObserveSnapshotEffects {
  const streamMeta: InlineSessionStreamMeta | null = {
    generating: event.generating,
    generationId: event.generationId,
  }

  if (!event.generating && event.generationId) {
    return {
      session: event.session,
      streamMeta,
      clearPreview: true,
      settleGeneration: {
        generationId: event.generationId,
        error: event.error ?? undefined,
      },
    }
  }

  if (!event.generating) {
    return {
      session: event.session,
      streamMeta,
      clearPreview: true,
    }
  }

  if (event.generationId) {
    return {
      session: event.session,
      streamMeta,
      clearPreview: false,
    }
  }

  return {
    session: event.session,
    streamMeta,
    clearPreview: true,
  }
}

export function shouldStartChunkPumpForGeneration(
  activeGenerationId: string | null,
  pumpGenerationId: string | null,
  eventGenerationId: string
): boolean {
  return (
    activeGenerationId !== eventGenerationId || pumpGenerationId !== eventGenerationId
  )
}
