import { Plugin } from 'prosemirror-state'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { inputRules, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { schema } from './schema'

// Input rules (Markdown Shortcuts)
function buildInputRules() {
  const rules = []

  // > blockquote
  if (schema.nodes.blockquote) {
    rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote))
  }

  // # heading (1-6)
  if (schema.nodes.heading) {
    rules.push(
      textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({
        level: match[1].length,
      }))
    )
  }

  // ``` code block
  if (schema.nodes.code_block) {
    rules.push(textblockTypeInputRule(/^```$/, schema.nodes.code_block))
  }

  return inputRules({ rules })
}

export function buildPlugins(extraPlugins: Plugin[] = []): Plugin[] {
  return [
    buildInputRules(),
    keymap({
      'Mod-z': undo,
      'Mod-Shift-z': redo,
      'Mod-y': redo,
    }),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    history(),
    ...extraPlugins,
  ]
}
