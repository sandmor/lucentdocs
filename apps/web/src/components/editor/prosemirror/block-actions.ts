import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { schema } from '@lucentdocs/shared'
import { blockOverlapsProtectedZone } from '../ai/ai-zone-protection'
import type { ActiveBlockInfo, BlockActionId } from './block-resolve'
import { supportsListTurnInto, supportsTurnInto, supportsTurnIntoMath } from './block-resolve'
import { moveBlockDown, moveBlockUp } from './block-move'
import { toCodeBlock, toParagraph } from './block-transforms'
import { insertListAfterBlock, turnBlockIntoList } from './list-commands'

const BLOCK_MUTATION_ACTIONS = new Set<BlockActionId>([
  'turn-into-paragraph',
  'turn-into-code',
  'turn-into-math',
  'turn-into-unordered-list',
  'turn-into-ordered-list',
  'turn-into-task-list',
  'move-up',
  'move-down',
  'duplicate',
  'delete',
])

/** Removes exactly one canonical display-math fence pair, if it wraps all text. */
function displayMathSourceFromBlockText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('$$') || !trimmed.endsWith('$$') || trimmed.length < 4) {
    return text
  }
  return trimmed.slice(2, -2).trim()
}

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

  if (action === 'turn-into-math' && !supportsTurnIntoMath(node)) return

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

  const replaceMathWithTextBlock = (target: 'paragraph' | 'code_block') => {
    const targetType = schema.nodes[target]
    if (!targetType) return
    const latex = String(node.attrs.latex ?? '')
    const text = target === 'paragraph' ? latex.replace(/[\r\n]+/g, ' ') : latex
    const content = text ? schema.text(text) : undefined
    const attrs =
      target === 'code_block'
        ? { id: node.attrs.id ?? null, language: '' }
        : { id: node.attrs.id ?? null }
    const replacement = targetType.create(attrs, content)
    const tr = state.tr.replaceWith(pos, pos + node.nodeSize, replacement)
    tr.setSelection(TextSelection.create(tr.doc, pos + 1))
    tr.scrollIntoView()
    dispatch(tr)
    view.focus()
  }

  const replaceTextBlockWithMath = () => {
    const mathBlock = schema.nodes.math_block
    if (!mathBlock) return
    const replacement = mathBlock.create({
      id: node.attrs.id ?? null,
      latex: displayMathSourceFromBlockText(node.textContent),
    })
    const tr = state.tr.replaceWith(pos, pos + node.nodeSize, replacement)
    tr.setSelection(NodeSelection.create(tr.doc, pos))
    tr.scrollIntoView()
    dispatch(tr)
    view.focus()
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
    case 'insert-math': {
      const mathBlock = schema.nodes.math_block
      const paragraph = schema.nodes.paragraph
      if (!mathBlock || !paragraph) return
      const insertPos = pos + node.nodeSize
      const tr = state.tr.insert(insertPos, [mathBlock.create(), paragraph.create()])
      tr.setSelection(NodeSelection.create(tr.doc, insertPos))
      tr.scrollIntoView()
      dispatch(tr)
      view.focus()
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
      if (node.type.name === 'math_block') replaceMathWithTextBlock('paragraph')
      else selectBlockAndTransform(() => toParagraph(view))
      break
    case 'turn-into-code':
      if (node.type.name === 'math_block') replaceMathWithTextBlock('code_block')
      else selectBlockAndTransform(() => toCodeBlock(view))
      break
    case 'turn-into-math':
      replaceTextBlockWithMath()
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
