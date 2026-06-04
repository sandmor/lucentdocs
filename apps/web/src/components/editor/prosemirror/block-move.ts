import type { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import type { ActiveBlockInfo } from './block-resolve'
import { canMoveBlockDown, canMoveBlockUp } from './block-resolve'

function moveBlock(view: EditorView, info: ActiveBlockInfo, direction: -1 | 1): boolean {
  const { state, dispatch } = view
  const { doc } = state
  const { pos, node } = info
  const nodeSize = node.nodeSize

  if (direction === -1 && !canMoveBlockUp(doc, pos)) return false
  if (direction === 1 && !canMoveBlockDown(doc, pos, nodeSize)) return false

  const $pos = doc.resolve(pos)
  const index = $pos.index(0)
  const siblingIndex = index + direction
  const sibling = doc.child(siblingIndex)

  const insertPos = direction === -1 ? pos - sibling.nodeSize : pos + nodeSize + sibling.nodeSize

  const tr = state.tr.delete(pos, pos + nodeSize)
  const mappedInsertPos = tr.mapping.map(insertPos)
  tr.insert(mappedInsertPos, node)

  const selectionPos = Math.min(mappedInsertPos + 1, tr.doc.content.size)
  tr.setSelection(TextSelection.create(tr.doc, selectionPos))
  tr.scrollIntoView()
  dispatch(tr)
  view.focus()
  return true
}

export function moveBlockUp(view: EditorView, info: ActiveBlockInfo): boolean {
  return moveBlock(view, info, -1)
}

export function moveBlockDown(view: EditorView, info: ActiveBlockInfo): boolean {
  return moveBlock(view, info, 1)
}
