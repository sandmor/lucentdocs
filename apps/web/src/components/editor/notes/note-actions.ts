import type { EditorView } from 'prosemirror-view'
import type * as Y from 'yjs'
import type { ActiveBlockInfo } from '../prosemirror/block-resolve'
import { createNoteInMap } from './notes-store'
import { getBlockIdAtPos } from './block-id-plugin'

export function addNoteForBlock(
  view: EditorView,
  info: ActiveBlockInfo,
  notesMap: Y.Map<unknown>,
  authorUserId: string
): string | null {
  const blockId = typeof info.node.attrs.id === 'string' ? info.node.attrs.id : getBlockIdAtPos(view.state.doc, info.pos + 1)
  if (!blockId) return null

  const note = createNoteInMap(notesMap, {
    blockId,
    placement: 'about',
    authorUserId,
  })

  return note.id
}
