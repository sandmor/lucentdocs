import type { EditorView } from 'prosemirror-view'
import { aiWriterPluginKey, getAIZones, type AIZone } from './writer-plugin'

export interface SessionUndoTargetOptions {
  isInlineAIControlsInteracting?: () => boolean
}

function caretOrSelectionOverlapsZone(view: EditorView, zone: AIZone): boolean {
  const { from, to, empty } = view.state.selection
  if (empty) {
    return from > zone.nodeFrom && from < zone.nodeTo
  }
  return from < zone.nodeTo && to > zone.nodeFrom
}

function resolveActiveZone(view: EditorView): AIZone | null {
  const pluginState = aiWriterPluginKey.getState(view.state)
  if (!pluginState?.zoneId) return null
  return getAIZones(view).find((zone) => zone.id === pluginState.zoneId) ?? null
}

function isPendingReviewZone(zone: AIZone): boolean {
  return !zone.streaming && Boolean(zone.sessionId)
}

function resolveFallbackZone(view: EditorView): AIZone | null {
  const pendingZones = getAIZones(view).filter(isPendingReviewZone)
  return pendingZones.find((zone) => caretOrSelectionOverlapsZone(view, zone)) ?? null
}

export function resolvePendingReviewZone(view: EditorView): AIZone | null {
  const pendingZones = getAIZones(view).filter(isPendingReviewZone)
  if (pendingZones.length === 0) return null

  const pluginState = aiWriterPluginKey.getState(view.state)
  if (pluginState?.zoneId) {
    const activeMatch = pendingZones.find((zone) => zone.id === pluginState.zoneId)
    if (activeMatch) return activeMatch
  }

  const overlapping = pendingZones.find((zone) => caretOrSelectionOverlapsZone(view, zone))
  if (overlapping) return overlapping

  if (pendingZones.length === 1) return pendingZones[0]

  return null
}

export function resolveSessionUndoTarget(
  view: EditorView,
  options: SessionUndoTargetOptions = {}
): { sessionId: string; zone: AIZone } | null {
  const zone = resolveActiveZone(view) ?? resolveFallbackZone(view)
  if (!zone?.sessionId) return null

  const controlsInteracting = options.isInlineAIControlsInteracting?.() ?? false
  if (controlsInteracting || caretOrSelectionOverlapsZone(view, zone)) {
    return { sessionId: zone.sessionId, zone }
  }

  return null
}

export function resolveSessionIdForZone(view: EditorView, zoneId: string): string | null {
  const zone = getAIZones(view).find((entry) => entry.id === zoneId)
  return zone?.sessionId ?? null
}
