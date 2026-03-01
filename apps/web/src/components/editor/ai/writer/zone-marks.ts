import { Slice, type MarkType } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { aiWriterPluginKey, getAIZones, type AIZone } from '../writer-plugin'
import type { AIZoneMarkAttrs, ZoneMarkPatch } from './types'

export function getAIZoneMarkType(view: EditorView): MarkType | null {
  return view.state.schema.marks.ai_zone ?? null
}

export function createZoneMarkAttrs(
  zoneId: string,
  streaming: boolean,
  sessionId: string | null,
  deletedSlice: string | null
): AIZoneMarkAttrs {
  return {
    id: zoneId,
    streaming,
    sessionId,
    deletedSlice,
  }
}

export function deserializeDeletedSlice(view: EditorView, value: string | null): Slice | null {
  if (!value) return null

  try {
    return Slice.fromJSON(view.state.schema, JSON.parse(value))
  } catch {
    return null
  }
}

export function getTargetZone(view: EditorView, preferredZoneId?: string): AIZone | null {
  if (preferredZoneId) {
    const preferred = getAIZones(view).find((zone) => zone.id === preferredZoneId)
    if (preferred) return preferred
  }

  const pluginState = aiWriterPluginKey.getState(view.state)
  if (pluginState?.zoneId) {
    const localZone = getAIZones(view).find((zone) => zone.id === pluginState.zoneId)
    if (localZone) return localZone
  }

  return null
}

export function upsertZoneMark(
  view: EditorView,
  from: number,
  to: number,
  attrs: AIZoneMarkAttrs,
  metaType?: string
): boolean {
  if (from >= to) return false

  const markType = getAIZoneMarkType(view)
  if (!markType) return false

  const tr = view.state.tr
  tr.removeMark(from, to, markType)
  tr.addMark(from, to, markType.create(attrs))

  if (metaType) {
    tr.setMeta(aiWriterPluginKey, { type: metaType })
  }

  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
  return true
}

export function updateZoneMark(
  view: EditorView,
  zoneId: string,
  patch: ZoneMarkPatch,
  metaType?: string
): boolean {
  const zone = getAIZones(view).find((entry) => entry.id === zoneId)
  if (!zone || zone.from >= zone.to) return false

  const attrs = createZoneMarkAttrs(
    zone.id,
    patch.streaming ?? zone.streaming,
    patch.sessionId === undefined ? zone.sessionId : patch.sessionId,
    patch.deletedSlice === undefined ? zone.deletedSlice : patch.deletedSlice
  )

  return upsertZoneMark(view, zone.from, zone.to, attrs, metaType)
}

export function selectionOverlapsAIZone(
  view: EditorView,
  selectionFrom: number,
  selectionTo: number
): boolean {
  if (selectionFrom >= selectionTo) return false

  for (const zone of getAIZones(view)) {
    if (selectionFrom < zone.to && selectionTo > zone.from) {
      return true
    }
  }

  return false
}
