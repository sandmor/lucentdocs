import { Plugin } from 'prosemirror-state'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { inputRules, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import * as Y from 'yjs'
import { ySyncPlugin, yUndoPlugin, undo as yUndo, redo as yRedo } from 'y-prosemirror'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@plotline/shared'
import { createAIWriterPlugin, type AIWriterActionHandlers } from './ai-writer-plugin'

export type ProsemirrorMapping = Map<Y.AbstractType<unknown>, PMNode | PMNode[]>

function buildInputRules() {
  const rules = []

  if (schema.nodes.blockquote) {
    rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote))
  }

  if (schema.nodes.heading) {
    rules.push(
      textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({
        level: match[1].length,
      }))
    )
  }

  if (schema.nodes.code_block) {
    rules.push(textblockTypeInputRule(/^```$/, schema.nodes.code_block))
  }

  return inputRules({ rules })
}

interface BuildPluginsOptions {
  aiHandlers?: AIWriterActionHandlers
  yjsFragment?: Y.XmlFragment
  yjsMapping?: ProsemirrorMapping
}

export function buildPlugins(options: BuildPluginsOptions = {}): Plugin[] {
  const { aiHandlers, yjsFragment, yjsMapping } = options

  const effectiveHandlers: AIWriterActionHandlers = aiHandlers ?? {
    onAccept() {},
    onReject() {},
    onCancelAI() {},
  }

  const plugins: Plugin[] = []

  if (yjsFragment && yjsMapping) {
    plugins.push(ySyncPlugin(yjsFragment, { mapping: yjsMapping }))
  }

  plugins.push(createAIWriterPlugin(effectiveHandlers))
  plugins.push(buildInputRules())

  if (yjsFragment) {
    plugins.push(yUndoPlugin())
    plugins.push(
      keymap({
        'Mod-z': yUndo,
        'Mod-Shift-z': yRedo,
        'Mod-y': yRedo,
      })
    )
  } else {
    plugins.push(history())
    plugins.push(
      keymap({
        'Mod-z': undo,
        'Mod-Shift-z': redo,
        'Mod-y': redo,
      })
    )
  }

  plugins.push(keymap(baseKeymap))
  plugins.push(dropCursor())
  plugins.push(gapCursor())

  return plugins
}
