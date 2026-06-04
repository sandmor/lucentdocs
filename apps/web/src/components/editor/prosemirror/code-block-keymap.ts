import {
  type EditorState,
  type Command,
  type Transaction,
  TextSelection,
} from 'prosemirror-state'
import { schema } from '@lucentdocs/shared'

/**
 * When the cursor is at the very start of an empty code_block,
 * convert it to a paragraph (lift the block).
 */
export function handleCodeBlockBackspace(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const { $from, empty } = state.selection
  if (!empty) return false

  const parent = $from.parent
  if (parent.type.name !== 'code_block') {
    return false
  }

  if ($from.parentOffset === 0 && parent.content.size === 0) {
    if (dispatch) {
      const tr = state.tr
      const blockStart = $from.before($from.depth)
      const blockEnd = $from.after($from.depth)
      tr.setBlockType(blockStart, blockEnd, schema.nodes.paragraph)
      tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map($from.pos)))
      dispatch(tr)
    }
    return true
  }

  return false
}

export function buildCodeBlockKeymapCommand(): Record<string, Command> {
  return {
    Backspace: handleCodeBlockBackspace as Command,
  }
}
