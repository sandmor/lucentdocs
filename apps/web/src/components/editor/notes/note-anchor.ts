import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import type { NoteAnchorKind } from '@lucentdocs/shared'

export interface ResolvedNoteAnchor {
  anchorId: string
  anchorKind: NoteAnchorKind
  pos: number
  top: number
  height: number
  orphan: boolean
}

export function buildTopLevelBlockIdIndexFromDoc(doc: PMNode): Map<string, number> {
  const index = new Map<string, number>()
  doc.forEach((node, offset) => {
    const id = node.attrs.id
    if (typeof id === 'string' && id.length > 0) {
      index.set(id, offset)
    }
  })
  return index
}

export function buildTopLevelBlockIdIndex(view: EditorView): Map<string, number> {
  return buildTopLevelBlockIdIndexFromDoc(view.state.doc)
}

export function resolveNoteAnchorPos(
  view: EditorView,
  anchorId: string,
  anchorKind: NoteAnchorKind,
  blockIndex: Map<string, number> = buildTopLevelBlockIdIndex(view)
): number | null {
  const blockPos = blockIndex.get(anchorId)
  if (blockPos === undefined) return null

  const block = view.state.doc.nodeAt(blockPos)
  if (!block) return null

  if (anchorKind === 'marker' || block.type.name === 'note_marker') {
    return blockPos + Math.max(1, Math.floor(block.nodeSize / 2))
  }

  return blockPos + 1
}

function resolveMarkerDomElement(view: EditorView, blockPos: number): HTMLElement | null {
  const dom = view.nodeDOM(blockPos)
  if (dom instanceof HTMLElement) return dom

  const domAtPos = view.domAtPos(blockPos)
  if (domAtPos.node instanceof HTMLElement) return domAtPos.node
  if (domAtPos.node.parentElement instanceof HTMLElement) return domAtPos.node.parentElement

  return null
}

function resolveMarkerDomLayout(
  view: EditorView,
  blockPos: number,
  anchorId: string,
  anchorKind: NoteAnchorKind,
  pos: number
): ResolvedNoteAnchor | null {
  const dom = resolveMarkerDomElement(view, blockPos)
  if (!dom) return null

  const rect = dom.getBoundingClientRect()
  return {
    anchorId,
    anchorKind,
    pos,
    top: rect.top,
    height: rect.height,
    orphan: false,
  }
}

export function computeNoteGutterDesiredTop(
  anchor: ResolvedNoteAnchor,
  options: { containerTop: number; orbSize: number }
): number {
  return (
    anchor.top -
    options.containerTop +
    (anchor.height - options.orbSize) / 2
  )
}

export function resolveNoteAnchorLayout(
  view: EditorView,
  anchorId: string,
  anchorKind: NoteAnchorKind,
  blockIndex?: Map<string, number>
): ResolvedNoteAnchor {
  const index = blockIndex ?? buildTopLevelBlockIdIndex(view)
  const blockPos = index.get(anchorId)
  if (blockPos === undefined) {
    return {
      anchorId,
      anchorKind,
      pos: 0,
      top: 0,
      height: 20,
      orphan: true,
    }
  }

  const block = view.state.doc.nodeAt(blockPos)
  if (!block) {
    return {
      anchorId,
      anchorKind,
      pos: 0,
      top: 0,
      height: 20,
      orphan: true,
    }
  }

  const effectiveAnchorKind: NoteAnchorKind =
    block.type.name === 'note_marker' ? 'marker' : anchorKind
  const isMarker = effectiveAnchorKind === 'marker'
  const pos = resolveNoteAnchorPos(view, anchorId, effectiveAnchorKind, index) ?? blockPos

  if (isMarker) {
    const markerLayout = resolveMarkerDomLayout(
      view,
      blockPos,
      anchorId,
      effectiveAnchorKind,
      pos
    )
    if (markerLayout) return markerLayout
  }

  try {
    const coords = view.coordsAtPos(pos)
    return {
      anchorId,
      anchorKind: effectiveAnchorKind,
      pos,
      top: coords.top,
      height: Math.max(20, coords.bottom - coords.top),
      orphan: false,
    }
  } catch {
    return {
      anchorId,
      anchorKind: effectiveAnchorKind,
      pos,
      top: 0,
      height: 20,
      orphan: true,
    }
  }
}

export function groupNotesByAnchorId<T extends { anchorId: string }>(notes: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const note of notes) {
    const existing = groups.get(note.anchorId) ?? []
    existing.push(note)
    groups.set(note.anchorId, existing)
  }
  return groups
}
