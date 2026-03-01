import type { InlineZoneSession } from '@plotline/shared'
import type { AIWriterState } from '../ai/writer-plugin'
import type { LoadingAnchor, ReviewZone } from './types'

export function resolveActiveLoadingAnchor(
  state: AIWriterState | null,
  sessionsById: Record<string, InlineZoneSession>
): LoadingAnchor | null {
  if (!state?.active || !state.streaming) return null

  const activeZone = state.zoneId ? state.zones.find((zone) => zone.id === state.zoneId) : null
  if (activeZone) {
    return {
      zoneId: activeZone.id,
      from: activeZone.from,
      to: activeZone.to,
      session: activeZone.sessionId ? (sessionsById[activeZone.sessionId] ?? null) : null,
    }
  }

  const from = state.originalSelectionFrom ?? state.from
  const to = state.originalSelectionTo ?? state.to

  if (from === null || to === null) return null

  return {
    zoneId: state.zoneId ?? undefined,
    from: Math.min(from, to),
    to: Math.max(from, to),
    session: state.sessionId ? (sessionsById[state.sessionId] ?? null) : null,
  }
}

export function resolveReviewZones(
  state: AIWriterState | null,
  loadingZoneId: string | null,
  sessionsById: Record<string, InlineZoneSession>
): ReviewZone[] {
  if (!state) return []
  const zonesFromMarks = state.zones
    .filter((zone) => zone.id !== loadingZoneId)
    .map((zone) => ({
      id: zone.id,
      from: zone.from,
      to: zone.to,
      streaming: zone.streaming,
      session: zone.sessionId ? (sessionsById[zone.sessionId] ?? null) : null,
    }))

  if (state.active && state.zoneId && state.zoneId !== loadingZoneId && state.sessionId) {
    const hasMark = state.zones.some((z) => z.id === state.zoneId)
    if (!hasMark && state.from !== null && state.to !== null) {
      zonesFromMarks.push({
        id: state.zoneId,
        from: Math.min(state.from, state.to),
        to: Math.max(state.from, state.to),
        streaming: state.streaming,
        session: sessionsById[state.sessionId] ?? null,
      })
    }
  }

  return zonesFromMarks
}

export function resolveActiveReviewZone(
  state: AIWriterState | null,
  activeLoadingAnchor: LoadingAnchor | null,
  reviewZones: ReviewZone[]
): ReviewZone | null {
  if (activeLoadingAnchor || reviewZones.length === 0) return null

  if (state?.zoneId) {
    const activeMatch = reviewZones.find((zone) => zone.id === state.zoneId)
    if (activeMatch) return activeMatch
  }

  return reviewZones[reviewZones.length - 1] ?? null
}
