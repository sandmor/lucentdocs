import { type Node as ProseMirrorNode } from 'prosemirror-model'
import { Transform } from 'prosemirror-transform'
import {
  parseMarkdownishToSlice,
  type InlineZoneWriteAction,
  hasMeaningfulGap,
  parseZoneNodeAttrs,
  wrapSliceWithZoneNodes,
  type AIZoneAttrs,
} from '@plotline/shared'

interface SessionZone {
  id: string
  nodeFrom: number
  nodeTo: number
  sessionId: string
  originalSlice: string | null
  streaming: boolean
}

function collectSessionZones(doc: ProseMirrorNode, sessionId: string): SessionZone[] {
  const zoneType = doc.type.schema.nodes.ai_zone
  if (!zoneType) return []

  const byId = new Map<string, SessionZone>()

  doc.descendants((node, pos) => {
    if (node.type !== zoneType) {
      return true
    }

    const parsed = parseZoneNodeAttrs(node.attrs, { requireSessionId: true })
    if (!parsed || parsed.sessionId !== sessionId) {
      return false
    }

    const segment = {
      nodeFrom: pos,
      nodeTo: pos + node.nodeSize,
    }

    const existing = byId.get(parsed.id)
    if (!existing) {
      byId.set(parsed.id, {
        ...parsed,
        sessionId: parsed.sessionId!,
        nodeFrom: segment.nodeFrom,
        nodeTo: segment.nodeTo,
      })
      return false
    }

    if (hasMeaningfulGap(doc, existing.nodeTo, segment.nodeFrom)) {
      return false
    }

    existing.nodeFrom = Math.min(existing.nodeFrom, segment.nodeFrom)
    existing.nodeTo = Math.max(existing.nodeTo, segment.nodeTo)
    existing.streaming = existing.streaming || parsed.streaming
    if (!existing.originalSlice && parsed.originalSlice) {
      existing.originalSlice = parsed.originalSlice
    }

    return false
  })

  return [...byId.values()].sort((left, right) => left.nodeFrom - right.nodeFrom)
}

function resolveSessionZone(doc: ProseMirrorNode, sessionId: string): SessionZone | null {
  const zones = collectSessionZones(doc, sessionId)
  if (zones.length === 0) return null
  return zones.find((zone) => zone.streaming) ?? zones[0] ?? null
}

export function applyInlineZoneWriteActionToDoc(
  doc: ProseMirrorNode,
  sessionId: string,
  action: InlineZoneWriteAction
): { changed: boolean; nextDoc: ProseMirrorNode; zoneFound: boolean } {
  if (action.type === 'set_choices') {
    return {
      changed: false,
      nextDoc: doc,
      zoneFound: false,
    }
  }

  const zone = resolveSessionZone(doc, sessionId)
  if (!zone) {
    return {
      changed: false,
      nextDoc: doc,
      zoneFound: false,
    }
  }

  const zoneText = doc.textBetween(zone.nodeFrom, zone.nodeTo, '\n\n', '\n')
  const zoneLength = zoneText.length
  const fromOffset = Math.max(0, Math.min(action.fromOffset, zoneLength))
  const toOffset = Math.max(fromOffset, Math.min(action.toOffset, zoneLength))

  const nextText = `${zoneText.slice(0, fromOffset)}${action.content}${zoneText.slice(toOffset)}`
  const replacement = parseMarkdownishToSlice(nextText)

  const zoneType = doc.type.schema.nodes.ai_zone
  if (!zoneType) {
    return {
      changed: false,
      nextDoc: doc,
      zoneFound: false,
    }
  }

  const attrs: AIZoneAttrs = {
    id: zone.id,
    streaming: true,
    sessionId: zone.sessionId,
    originalSlice: zone.originalSlice,
  }
  const wrappedReplacement = wrapSliceWithZoneNodes(replacement, zoneType, attrs)

  const tr = new Transform(doc)
  tr.replaceRange(zone.nodeFrom, zone.nodeTo, wrappedReplacement)

  return {
    changed: !tr.doc.eq(doc),
    nextDoc: tr.doc,
    zoneFound: true,
  }
}
