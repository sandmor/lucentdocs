import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { Transform } from 'prosemirror-transform'
import {
  createWrappedZoneSliceFromText,
  gapBreaksZoneSegmentChain,
  parseZoneNodeAttrs,
  type AIZoneAttrs,
} from './ai-zone-utils.js'

interface ResolvedZone {
  id: string
  nodeFrom: number
  nodeTo: number
  sessionId: string
  originalSlice: string | null
  streaming: boolean
}

function resolveZone(doc: ProseMirrorNode, sessionId: string): ResolvedZone | null {
  const zoneType = doc.type.schema.nodes.ai_zone
  if (!zoneType) return null

  const zones = new Map<string, ResolvedZone>()
  doc.descendants((node, pos) => {
    if (node.type !== zoneType) return true
    const attrs = parseZoneNodeAttrs(node.attrs, { requireSessionId: true })
    if (!attrs || attrs.sessionId !== sessionId) return false

    const existing = zones.get(attrs.id)
    if (!existing) {
      zones.set(attrs.id, {
        id: attrs.id,
        nodeFrom: pos,
        nodeTo: pos + node.nodeSize,
        sessionId: attrs.sessionId,
        originalSlice: attrs.originalSlice,
        streaming: attrs.streaming,
      })
      return false
    }

    if (!gapBreaksZoneSegmentChain(doc, existing.nodeTo, pos)) {
      existing.nodeTo = pos + node.nodeSize
      existing.streaming ||= attrs.streaming
      existing.originalSlice ||= attrs.originalSlice
    }
    return false
  })

  const candidates = [...zones.values()]
  return candidates.find((zone) => zone.streaming) ?? candidates[0] ?? null
}

export interface AIZoneTextReplacement {
  changed: boolean
  nextDoc: ProseMirrorNode
  zoneFound: boolean
}

/**
 * Replaces the full logical zone text using the same slice-open behavior as a
 * committed inline generation. It is pure so clients can render a transient
 * preview without touching the shared Yjs document.
 */
export function replaceAIZoneTextInDoc(
  doc: ProseMirrorNode,
  sessionId: string,
  content: string,
  streaming: boolean
): AIZoneTextReplacement {
  const zone = resolveZone(doc, sessionId)
  const zoneType = doc.type.schema.nodes.ai_zone
  if (!zone || !zoneType) {
    return { changed: false, nextDoc: doc, zoneFound: false }
  }

  const attrs: AIZoneAttrs = {
    id: zone.id,
    streaming,
    sessionId: zone.sessionId,
    originalSlice: zone.originalSlice,
  }
  const replacement = createWrappedZoneSliceFromText(
    doc,
    zone.nodeFrom,
    zone.nodeTo,
    content,
    zoneType,
    attrs
  )
  const tr = new Transform(doc)
  tr.replaceRange(zone.nodeFrom, zone.nodeTo, replacement)
  return { changed: !tr.doc.eq(doc), nextDoc: tr.doc, zoneFound: true }
}

export function hasStreamingAIZone(doc: ProseMirrorNode, sessionId: string): boolean {
  return resolveZone(doc, sessionId)?.streaming === true
}
