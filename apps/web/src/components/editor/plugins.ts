import { Plugin } from 'prosemirror-state'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { inputRules, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { schema } from './schema'
import {
  createAIWriterPlugin,
  type AIWriterActionHandlers,
  type AIWriterDraftRange,
} from './ai-writer-plugin'

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

interface BuildPluginsOptions {
  aiDraft?: AIWriterDraftRange | null
  aiHandlers?: AIWriterActionHandlers
  extraPlugins?: Plugin[]
}

export function buildPlugins(options: BuildPluginsOptions = {}): Plugin[] {
  const { aiDraft = null, aiHandlers, extraPlugins = [] } = options
  const effectiveHandlers: AIWriterActionHandlers = aiHandlers ?? {
    onAccept() { },
    onReject() { },
    onCancelAI() { },
  }

  return [
    createAIWriterPlugin(aiDraft, effectiveHandlers),
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
