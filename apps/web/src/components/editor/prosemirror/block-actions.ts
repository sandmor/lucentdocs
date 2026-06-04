import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import { schema } from '@lucentdocs/shared'
import type { ActiveBlockInfo, BlockActionId } from './block-resolve'
import { moveBlockDown, moveBlockUp } from './block-move'
import { toCodeBlock, toParagraph } from './block-transforms'

export function handleBlockAction(
  view: EditorView,
  action: BlockActionId,
  info: ActiveBlockInfo
): void {
  const { state, dispatch } = view
  const freshNode = state.doc.nodeAt(info.pos)
  if (!freshNode) return

  const { pos, node } = { pos: info.pos, node: freshNode }

  const insertAfter = (newNode: PMNode) => {
    const insertPos = pos + node.nodeSize
    const tr = state.tr.insert(insertPos, newNode)
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1))
    tr.scrollIntoView()
    dispatch(tr)
    view.focus()
  }

  const selectBlockAndTransform = (transformFn: () => boolean) => {
    const tr = state.tr.setSelection(TextSelection.create(state.doc, pos + 1))
    view.dispatch(tr)
    transformFn()
  }

  switch (action) {
    case 'insert-paragraph': {
      const paragraph = schema.nodes.paragraph
      if (!paragraph) return
      insertAfter(paragraph.create())
      break
    }
    case 'insert-code': {
      const codeBlock = schema.nodes.code_block
      if (!codeBlock) return
      insertAfter(codeBlock.create())
      break
    }
    case 'turn-into-paragraph':
      selectBlockAndTransform(() => toParagraph(view))
      break
    case 'turn-into-code':
      selectBlockAndTransform(() => toCodeBlock(view))
      break
    case 'move-up':
      moveBlockUp(view, info)
      break
    case 'move-down':
      moveBlockDown(view, info)
      break
    case 'duplicate': {
      const newNode = node.type.create(node.attrs, node.content)
      insertAfter(newNode)
      break
    }
    case 'delete': {
      const tr = state.tr.delete(pos, pos + node.nodeSize)
      const mappedPos = tr.mapping.map(pos, -1)
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(mappedPos, tr.doc.content.size))))
      dispatch(tr)
      view.focus()
      break
    }
    default:
      break
  }
}
