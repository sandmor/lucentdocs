import type { AIWriterState } from '../ai/writer-plugin'
import type { InlineSessionStreamMeta } from '@/lib/editor-store'

/** Session IDs that need a live observeSession subscription (streaming only). */
export function resolveObservedInlineSessionIds(
  aiState: AIWriterState | null,
  streamMetaById: Record<string, InlineSessionStreamMeta>
): string[] {
  if (!aiState) return []

  const sessionIds = new Set<string>()

  for (const zone of aiState.zones) {
    if (!zone.sessionId) continue
    if (zone.streaming || streamMetaById[zone.sessionId]?.generating) {
      sessionIds.add(zone.sessionId)
    }
  }

  if (aiState.sessionId) {
    const metaGenerating = streamMetaById[aiState.sessionId]?.generating === true
    if (aiState.active && (aiState.streaming || metaGenerating)) {
      sessionIds.add(aiState.sessionId)
    }
  }

  return [...sessionIds].sort((left, right) => left.localeCompare(right))
}

/** Session IDs to hydrate from the server (all zones plus active compose). */
export function resolveHydratedInlineSessionIds(aiState: AIWriterState | null): string[] {
  if (!aiState) return []

  const sessionIds = new Set<string>()
  for (const zone of aiState.zones) {
    if (zone.sessionId) sessionIds.add(zone.sessionId)
  }
  if (aiState.sessionId) sessionIds.add(aiState.sessionId)

  return [...sessionIds].sort((left, right) => left.localeCompare(right))
}
