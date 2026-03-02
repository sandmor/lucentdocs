import { Fragment, Slice } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import {
  wrapSliceWithZoneNodes as wrapSliceWithZoneNodesShared,
  type AIZoneAttrs,
} from '@plotline/shared'
import { aiWriterPluginKey, getAIZones, type AIZone } from '../writer-plugin'
import type { AIZoneNodeAttrs, ZoneNodePatch } from './types'

export function getAIZoneNodeType(view: EditorView) {
  return view.state.schema.nodes.ai_zone ?? null
}

export function createZoneNodeAttrs(
  zoneId: string,
  streaming: boolean,
  sessionId: string | null,
  originalSlice: string | null
): AIZoneNodeAttrs {
  return {
    id: zoneId,
    streaming,
    sessionId,
    originalSlice,
  }
}

export function wrapSliceWithZoneNodes(
  view: EditorView,
  slice: Slice,
  attrs: AIZoneNodeAttrs
): Slice | null {
  const nodeType = getAIZoneNodeType(view)
  if (!nodeType) return null
  return wrapSliceWithZoneNodesShared(slice, nodeType, attrs)
}

export function createEmptyZoneSlice(view: EditorView, attrs: AIZoneNodeAttrs): Slice | null {
  const nodeType = getAIZoneNodeType(view)
  if (!nodeType) return null
  return new Slice(Fragment.from(nodeType.create(attrs)), 0, 0)
}

export function deserializeOriginalSlice(view: EditorView, value: string | null): Slice | null {
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

export function updateZoneNode(
  view: EditorView,
  zoneId: string,
  patch: ZoneNodePatch,
  metaType?: string
): boolean {
  const zone = getAIZones(view).find((entry) => entry.id === zoneId)
  if (!zone) return false

  const nodeType = getAIZoneNodeType(view)
  if (!nodeType) return false

  const attrs = createZoneNodeAttrs(
    zone.id,
    patch.streaming ?? zone.streaming,
    patch.sessionId === undefined ? zone.sessionId : patch.sessionId,
    patch.originalSlice === undefined ? zone.originalSlice : patch.originalSlice
  )

  const tr = view.state.tr
  for (const segment of [...zone.segments].sort((left, right) => right.nodeFrom - left.nodeFrom)) {
    const mappedFrom = tr.mapping.map(segment.nodeFrom, -1)
    const node = tr.doc.nodeAt(mappedFrom)
    if (!node || node.type !== nodeType) {
      continue
    }

    tr.setNodeMarkup(mappedFrom, nodeType, attrs)
  }

  if (!tr.docChanged) {
    return false
  }

  if (metaType) {
    tr.setMeta(aiWriterPluginKey, { type: metaType })
  }
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
  return true
}

export function replaceZoneContent(
  view: EditorView,
  zoneId: string,
  content: Slice,
  options: {
    streaming?: boolean
    metaType?: string
    addToHistory?: boolean
  } = {}
): boolean {
  const zone = getAIZones(view).find((entry) => entry.id === zoneId)
  if (!zone) return false

  const nodeType = getAIZoneNodeType(view)
  if (!nodeType) return false

  const attrs: AIZoneAttrs = {
    id: zone.id,
    streaming: options.streaming ?? zone.streaming,
    sessionId: zone.sessionId,
    originalSlice: zone.originalSlice,
  }
  const wrappedContent = wrapSliceWithZoneNodesShared(content, nodeType, attrs)

  const tr = view.state.tr
  tr.replaceRange(zone.nodeFrom, zone.nodeTo, wrappedContent)

  if (options.metaType) {
    tr.setMeta(aiWriterPluginKey, { type: options.metaType })
  }

  tr.setMeta('addToHistory', options.addToHistory === true)
  view.dispatch(tr)
  return true
}

export function unwrapZoneNodes(
  view: EditorView,
  zoneId: string,
  options: { metaType?: string; addToHistory?: boolean } = {}
): boolean {
  const zone = getAIZones(view).find((entry) => entry.id === zoneId)
  if (!zone) return false

  const nodeType = getAIZoneNodeType(view)
  if (!nodeType) return false

  const tr = view.state.tr
  for (const segment of [...zone.segments].sort((left, right) => right.nodeFrom - left.nodeFrom)) {
    const mappedFrom = tr.mapping.map(segment.nodeFrom, -1)
    const node = tr.doc.nodeAt(mappedFrom)
    if (!node || node.type !== nodeType || node.attrs.id !== zoneId) {
      continue
    }

    tr.replaceWith(mappedFrom, mappedFrom + node.nodeSize, node.content)
  }

  if (!tr.docChanged) {
    return false
  }

  if (options.metaType) {
    tr.setMeta(aiWriterPluginKey, { type: options.metaType })
  }
  tr.setMeta('addToHistory', options.addToHistory === true)
  view.dispatch(tr)
  return true
}

export function selectionOverlapsAIZone(
  view: EditorView,
  selectionFrom: number,
  selectionTo: number
): boolean {
  if (selectionFrom >= selectionTo) return false

  for (const zone of getAIZones(view)) {
    if (selectionFrom < zone.nodeTo && selectionTo > zone.nodeFrom) {
      return true
    }
  }

  return false
}
