import type { EditorView } from 'prosemirror-view'
import type { NotePlacement } from '@lucentdocs/shared'

export interface ResolvedNoteAnchor {
  blockId: string
  placement: NotePlacement
  pos: number
  top: number
  height: number
  orphan: boolean
}

export function buildTopLevelBlockIdIndex(view: EditorView): Map<string, number> {
  const index = new Map<string, number>()
  const doc = view.state.doc

  doc.forEach((node, offset) => {
    const id = node.attrs.id
    if (typeof id === 'string' && id.length > 0) {
      index.set(id, offset)
    }
  })

  return index
}

export function resolveNoteAnchorPos(
  view: EditorView,
  blockId: string,
  placement: NotePlacement,
  blockIndex: Map<string, number> = buildTopLevelBlockIdIndex(view)
): number | null {
  const blockPos = blockIndex.get(blockId)
  if (blockPos === undefined) return null

  const block = view.state.doc.nodeAt(blockPos)
  if (!block) return null

  if (placement === 'after') {
    return blockPos + block.nodeSize
  }

  return blockPos + 1
}

export function resolveNoteAnchorLayout(
  view: EditorView,
  blockId: string,
  placement: NotePlacement,
  blockIndex?: Map<string, number>
): ResolvedNoteAnchor | null {
  const index = blockIndex ?? buildTopLevelBlockIdIndex(view)
  const pos = resolveNoteAnchorPos(view, blockId, placement, index)
  if (pos === null) {
    return {
      blockId,
      placement,
      pos: 0,
      top: 0,
      height: 20,
      orphan: true,
    }
  }

  try {
    const coords = view.coordsAtPos(pos)
    return {
      blockId,
      placement,
      pos,
      top: coords.top,
      height: Math.max(20, coords.bottom - coords.top),
      orphan: false,
    }
  } catch {
    return {
      blockId,
      placement,
      pos,
      top: 0,
      height: 20,
      orphan: true,
    }
  }
}

export function groupNotesByBlockId<T extends { blockId: string }>(notes: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const note of notes) {
    const existing = groups.get(note.blockId) ?? []
    existing.push(note)
    groups.set(note.blockId, existing)
  }
  return groups
}
