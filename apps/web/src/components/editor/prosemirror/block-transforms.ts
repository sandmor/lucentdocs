import { setBlockType } from 'prosemirror-commands'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import { schema } from '@lucentdocs/shared'

function blockIdAttrs(node: PMNode): { id: string | null } {
  const id = node.attrs.id
  return { id: typeof id === 'string' && id.length > 0 ? id : null }
}

function textContentForCode(node: PMNode): string {
  return node.textBetween(0, node.content.size, '', (leaf) => {
    if (leaf.type === schema.nodes.hard_break) return '\n'
    if (leaf.type === schema.nodes.image) {
      const alt = leaf.attrs.alt
      if (typeof alt === 'string' && alt.length > 0) return alt
      const src = leaf.attrs.src
      return typeof src === 'string' ? src : ''
    }
    return ''
  })
}

function paragraphContentFromCode(text: string): PMNode[] {
  const hardBreak = schema.nodes.hard_break
  if (!hardBreak || text.length === 0) return []

  const content: PMNode[] = []
  const lines = text.split(/\r\n?|\n/)
  lines.forEach((line, index) => {
    if (line.length > 0) content.push(schema.text(line))
    if (index < lines.length - 1) content.push(hardBreak.create())
  })
  return content
}

export function toParagraph(view: EditorView): boolean {
  const { state, dispatch } = view
  const paragraph = schema.nodes.paragraph
  if (!paragraph) return false

  const { $from } = state.selection
  if ($from.parent.type === schema.nodes.code_block) {
    return fromCodeBlockToParagraph(view)
  }

  if (!$from.parent.isTextblock) return false
  const converted = setBlockType(paragraph, blockIdAttrs($from.parent))(state, dispatch)
  if (converted) view.focus()
  return converted
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
  const text = textContentForCode(targetNode)
  const content = text ? schema.text(text) : undefined
  const newNode = codeBlock.create(
    { language: language ?? '', ...blockIdAttrs(targetNode) },
    content
  )

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
  const content = paragraphContentFromCode(node.textContent)
  const newNode = paragraph.create(blockIdAttrs(node), content)

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
  const tr = state.tr.setBlockType(
    blockStart,
    blockEnd,
    schema.nodes.paragraph,
    blockIdAttrs(parent)
  )
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map($from.pos)))
  dispatch(tr)
  return true
}
