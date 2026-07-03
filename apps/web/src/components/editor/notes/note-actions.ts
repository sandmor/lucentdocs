import type { EditorView } from 'prosemirror-view'
import type * as Y from 'yjs'
import type { ActiveBlockInfo } from '../prosemirror/block-resolve'
import { isListBlockType } from '../prosemirror/block-resolve'
import { createNoteInMap } from './notes-store'
import { getBlockIdAtPos } from './block-id-plugin'
import type { NoteAnchorKind } from '@lucentdocs/shared'

function resolveAnchorId(view: EditorView, info: ActiveBlockInfo): string | null {
  return typeof info.node.attrs.id === 'string'
    ? info.node.attrs.id
    : getBlockIdAtPos(view.state.doc, info.pos + 1)
}

export function addNoteForBlock(
  view: EditorView,
  info: ActiveBlockInfo,
  notesMap: Y.Map<unknown>,
  authorUserId: string
): { id: string; anchorId: string } | null {
  if (isListBlockType(info.node.type.name)) return null

  const anchorId = resolveAnchorId(view, info)
  if (!anchorId) return null

  const anchorKind: NoteAnchorKind =
    info.node.type.name === 'note_marker' ? 'marker' : 'block'

  const note = createNoteInMap(notesMap, {
    anchorKind,
    anchorId,
    authorUserId,
  })

  return { id: note.id, anchorId }
}
