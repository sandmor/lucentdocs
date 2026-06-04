import { setBlockType } from 'prosemirror-commands'
import type { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import { schema } from '@lucentdocs/shared'

export function toParagraph(view: EditorView): boolean {
  const { state, dispatch } = view
  const paragraph = schema.nodes.paragraph
  if (!paragraph) return false

  const { $from } = state.selection
  if ($from.parent.type === schema.nodes.code_block) {
    return fromCodeBlockToParagraph(view)
  }

  if (!$from.parent.isTextblock) return false
  return setBlockType(paragraph)(state, dispatch)
}

export function toCodeBlock(view: EditorView, language: string | null = null): boolean {
  const { state, dispatch } = view
  const codeBlock = schema.nodes.code_block
  if (!codeBlock) return false

  const { $from } = state.selection

  if ($from.parent.type === codeBlock) return true

  if (!$from.parent.isTextblock) return false

  const targetPos = $from.before($from.depth)
  const targetNode = $from.parent
  const text = targetNode.textContent
  const content = text ? schema.text(text) : undefined
  const newNode = codeBlock.create({ language: language ?? '' }, content)

  const tr = state.tr.replaceWith(targetPos, targetPos + targetNode.nodeSize, newNode)
  tr.setSelection(TextSelection.create(tr.doc, targetPos + 1))
  tr.scrollIntoView()
  dispatch(tr)
  view.focus()
  return true
}

export function fromCodeBlockToParagraph(view: EditorView): boolean {
  const { state, dispatch } = view
  const paragraph = schema.nodes.paragraph
  const codeBlock = schema.nodes.code_block
  if (!paragraph || !codeBlock) return false

  const { $from } = state.selection

  if ($from.parent.type !== codeBlock) {
    return toParagraph(view)
  }

  const pos = $from.before($from.depth)
  const node = $from.parent
  const text = node.textContent
  const content = text ? schema.text(text) : undefined
  const newNode = paragraph.create(null, content)

  const tr = state.tr.replaceWith(pos, pos + node.nodeSize, newNode)
  tr.setSelection(TextSelection.create(tr.doc, pos + 1))
  tr.scrollIntoView()
  dispatch(tr)
  view.focus()
  return true
}

export function emptyCodeBlockToParagraph(
  state: import('prosemirror-state').EditorState,
  dispatch?: (tr: import('prosemirror-state').Transaction) => void
): boolean {
  const { $from, empty } = state.selection
  if (!empty) return false

  const parent = $from.parent
  if (parent.type.name !== 'code_block') return false
  if ($from.parentOffset !== 0 || parent.content.size !== 0) return false

  if (!dispatch) return true

  const blockStart = $from.before($from.depth)
  const blockEnd = $from.after($from.depth)
  const tr = state.tr.setBlockType(blockStart, blockEnd, schema.nodes.paragraph)
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map($from.pos)))
  dispatch(tr)
  return true
}
