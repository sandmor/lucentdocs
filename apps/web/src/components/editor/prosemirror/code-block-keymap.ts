import { type Command } from 'prosemirror-state'
import { emptyCodeBlockToParagraph } from './block-transforms'

/**
 * When the cursor is at the very start of an empty code_block,
 * convert it to a paragraph (lift the block).
 */
export const handleCodeBlockBackspace: Command = (state, dispatch) => {
  return emptyCodeBlockToParagraph(state, dispatch)
}

export function buildCodeBlockKeymapCommand(): Record<string, Command> {
  return {
    Backspace: handleCodeBlockBackspace,
  }
}
