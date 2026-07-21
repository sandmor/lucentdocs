import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import { schema } from '@lucentdocs/shared'
import { blockOverlapsProtectedZone } from '../ai/ai-zone-protection'
import type { ActiveBlockInfo, BlockActionId } from './block-resolve'
import { supportsListTurnInto, supportsTurnInto } from './block-resolve'
import { moveBlockDown, moveBlockUp } from './block-move'
import { toCodeBlock, toParagraph } from './block-transforms'
import { insertListAfterBlock, turnBlockIntoList } from './list-commands'

const BLOCK_MUTATION_ACTIONS = new Set<BlockActionId>([
  'turn-into-paragraph',
  'turn-into-code',
  'turn-into-unordered-list',
  'turn-into-ordered-list',
  'turn-into-task-list',
  'move-up',
  'move-down',
  'duplicate',
  'delete',
])

export function handleBlockAction(
  view: EditorView,
  action: BlockActionId,
  info: ActiveBlockInfo
): void {
  const { state, dispatch } = view
  const freshNode = state.doc.nodeAt(info.pos)
  if (!freshNode) return

  const { pos, node } = { pos: info.pos, node: freshNode }

  if (
    (action === 'turn-into-paragraph' || action === 'turn-into-code') &&
    !supportsTurnInto(node)
  ) {
    return
  }

  if (
    (action === 'turn-into-unordered-list' ||
      action === 'turn-into-ordered-list' ||
      action === 'turn-into-task-list') &&
    !supportsListTurnInto(node)
  ) {
    return
  }

  if (BLOCK_MUTATION_ACTIONS.has(action) && blockOverlapsProtectedZone(view, pos, node.nodeSize)) {
    return
  }

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
    case 'insert-divider': {
      const divider = schema.nodes.horizontal_rule
      const paragraph = schema.nodes.paragraph
      if (!divider || !paragraph) return
      const insertPos = pos + node.nodeSize
      const tr = state.tr.insert(insertPos, [divider.create(), paragraph.create()])
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 2))
      tr.scrollIntoView()
      dispatch(tr)
      view.focus()
      break
    }
    case 'insert-unordered-list':
      insertListAfterBlock(view, pos, node, 'bullet')
      break
    case 'insert-ordered-list':
      insertListAfterBlock(view, pos, node, 'ordered')
      break
    case 'insert-task-list':
      insertListAfterBlock(view, pos, node, 'task')
      break
    case 'turn-into-paragraph':
      selectBlockAndTransform(() => toParagraph(view))
      break
    case 'turn-into-code':
      selectBlockAndTransform(() => toCodeBlock(view))
      break
    case 'turn-into-unordered-list':
      turnBlockIntoList(view, pos, node, 'bullet')
      break
    case 'turn-into-ordered-list':
      turnBlockIntoList(view, pos, node, 'ordered')
      break
    case 'turn-into-task-list':
      turnBlockIntoList(view, pos, node, 'task')
      break
    case 'move-up':
      moveBlockUp(view, info)
      break
    case 'move-down':
      moveBlockDown(view, info)
      break
    case 'duplicate': {
      if (node.type.name === 'note_marker') return
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
