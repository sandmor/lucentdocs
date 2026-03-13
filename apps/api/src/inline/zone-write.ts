import { Fragment, type Node as ProseMirrorNode } from 'prosemirror-model'
import { Transform } from 'prosemirror-transform'
import {
  type InlineZoneWriteAction,
  hasMeaningfulGap,
  parseZoneNodeAttrs,
  createWrappedZoneSliceFromText,
  type AIZoneAttrs,
} from '@lucentdocs/shared'

interface SessionZone {
  id: string
  nodeFrom: number
  nodeTo: number
  sessionId: string
  originalSlice: string | null
  streaming: boolean
}

interface SessionZoneSegment {
  id: string
  nodeFrom: number
  sessionId: string
  originalSlice: string | null
}

/**
 * Adjacent `ai_zone` nodes with the same session id are treated as one logical
 * zone unless meaningful document content separates them.
 */
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

function collectSessionZoneSegments(doc: ProseMirrorNode, sessionId: string): SessionZoneSegment[] {
  const zoneType = doc.type.schema.nodes.ai_zone
  if (!zoneType) return []

  const segments: SessionZoneSegment[] = []
  doc.descendants((node, pos) => {
    if (node.type !== zoneType) return true

    const parsed = parseZoneNodeAttrs(node.attrs, { requireSessionId: true })
    if (!parsed || parsed.sessionId !== sessionId) return false

    segments.push({
      id: parsed.id,
      nodeFrom: pos,
      sessionId: parsed.sessionId!,
      originalSlice: parsed.originalSlice,
    })
    return false
  })

  return segments.sort((left, right) => left.nodeFrom - right.nodeFrom)
}

function resolveSessionZone(doc: ProseMirrorNode, sessionId: string): SessionZone | null {
  const zones = collectSessionZones(doc, sessionId)
  if (zones.length === 0) return null
  return zones.find((zone) => zone.streaming) ?? zones[0] ?? null
}

function findLastInlineTextblock(
  doc: ProseMirrorNode
): { node: ProseMirrorNode; pos: number } | null {
  let match: { node: ProseMirrorNode; pos: number } | null = null

  doc.descendants((node, pos) => {
    if (node.isTextblock && node.inlineContent) {
      match = { node, pos }
    }
    return true
  })

  return match
}

export function getInlineZoneTextFromDoc(
  doc: ProseMirrorNode,
  sessionId: string
): { zoneFound: boolean; text: string } {
  const zone = resolveSessionZone(doc, sessionId)
  if (!zone) {
    return {
      zoneFound: false,
      text: '',
    }
  }

  return {
    zoneFound: true,
    text: doc.textBetween(zone.nodeFrom, zone.nodeTo, '\n\n', '\n'),
  }
}

export interface InlineZoneSnapshot {
  zoneFound: boolean
  nodeFrom: number
  nodeTo: number
}

export function getInlineZoneSnapshotFromDoc(
  doc: ProseMirrorNode,
  sessionId: string
): InlineZoneSnapshot {
  const zone = resolveSessionZone(doc, sessionId)
  if (!zone) {
    return {
      zoneFound: false,
      nodeFrom: 0,
      nodeTo: 0,
    }
  }

  return {
    zoneFound: true,
    nodeFrom: zone.nodeFrom,
    nodeTo: zone.nodeTo,
  }
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
  const wrappedReplacement = createWrappedZoneSliceFromText(
    doc,
    zone.nodeFrom,
    zone.nodeTo,
    nextText,
    zoneType,
    attrs
  )

  const tr = new Transform(doc)
  tr.replaceRange(zone.nodeFrom, zone.nodeTo, wrappedReplacement)

  return {
    changed: !tr.doc.eq(doc),
    nextDoc: tr.doc,
    zoneFound: true,
  }
}

export function setInlineZoneStreamingInDoc(
  doc: ProseMirrorNode,
  sessionId: string,
  streaming: boolean
): { changed: boolean; nextDoc: ProseMirrorNode; zoneFound: boolean } {
  const segments = collectSessionZoneSegments(doc, sessionId)
  if (segments.length === 0) {
    return {
      changed: false,
      nextDoc: doc,
      zoneFound: false,
    }
  }

  const zoneType = doc.type.schema.nodes.ai_zone
  if (!zoneType) {
    return {
      changed: false,
      nextDoc: doc,
      zoneFound: false,
    }
  }

  const tr = new Transform(doc)
  for (const segment of segments.sort((left, right) => right.nodeFrom - left.nodeFrom)) {
    const attrs: AIZoneAttrs = {
      id: segment.id,
      streaming,
      sessionId: segment.sessionId,
      originalSlice: segment.originalSlice,
    }

    const segmentFrom = tr.mapping.map(segment.nodeFrom, -1)
    const node = tr.doc.nodeAt(segmentFrom)
    if (!node || node.type !== zoneType) continue
    tr.setNodeMarkup(segmentFrom, zoneType, attrs)
  }

  return {
    changed: !tr.doc.eq(doc),
    nextDoc: tr.doc,
    zoneFound: true,
  }
}

export function ensureInlineContinuationZoneAtDocumentEnd(
  doc: ProseMirrorNode,
  sessionId: string,
  expectedTailAnchor: string
): { changed: boolean; nextDoc: ProseMirrorNode; zoneFound: boolean } {
  // Only recreate terminal continuation zones when the document still ends at
  // the same textual anchor the generation started from.
  const existingZone = resolveSessionZone(doc, sessionId)
  if (existingZone) {
    return {
      changed: false,
      nextDoc: doc,
      zoneFound: true,
    }
  }

  const expected = expectedTailAnchor
  if (expected.length > 0) {
    const docEnd = doc.content.size
    // Avoid materializing full document text; only read a large tail window.
    // ProseMirror positions roughly correlate with characters in typical docs.
    const tailWindow = Math.min(docEnd, Math.max(2048, expected.length * 8))
    const tailText = doc.textBetween(Math.max(0, docEnd - tailWindow), docEnd, '\n\n', '\n')
    if (!tailText.endsWith(expected)) {
      return {
        changed: false,
        nextDoc: doc,
        zoneFound: false,
      }
    }
  } else {
    return {
      changed: false,
      nextDoc: doc,
      zoneFound: false,
    }
  }

  const zoneType = doc.type.schema.nodes.ai_zone
  const paragraphType = doc.type.schema.nodes.paragraph
  if (!zoneType) {
    return {
      changed: false,
      nextDoc: doc,
      zoneFound: false,
    }
  }

  const zoneNode = zoneType.create({
    id: `zone_${sessionId}`,
    streaming: true,
    sessionId,
    originalSlice: null,
  })

  const tr = new Transform(doc)
  const lastInlineTextblock = findLastInlineTextblock(tr.doc)

  if (lastInlineTextblock) {
    const replacement = lastInlineTextblock.node.copy(
      lastInlineTextblock.node.content.append(Fragment.from(zoneNode))
    )
    tr.replaceWith(
      lastInlineTextblock.pos,
      lastInlineTextblock.pos + lastInlineTextblock.node.nodeSize,
      replacement
    )
  } else if (paragraphType) {
    tr.insert(tr.doc.content.size, paragraphType.create(null, [zoneNode]))
  } else {
    return {
      changed: false,
      nextDoc: doc,
      zoneFound: false,
    }
  }

  return {
    changed: !tr.doc.eq(doc),
    nextDoc: tr.doc,
    zoneFound: true,
  }
}
