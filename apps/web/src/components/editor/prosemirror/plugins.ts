import { Plugin, type Command, type EditorState } from 'prosemirror-state'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { inputRules, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules'
import { gapCursor } from 'prosemirror-gapcursor'
import * as Y from 'yjs'
import { ySyncPlugin, yUndoPlugin, undoCommand as yUndo, redoCommand as yRedo } from 'y-prosemirror'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '@lucentdocs/shared'
import type { MarkType } from 'prosemirror-model'
import { createAIWriterPlugin, type AIWriterActionHandlers } from '../ai/writer-plugin'
import { buildAIZoneUndoCommands } from '../ai/ai-zone-undo-keymap'
import type { AIWriterController } from '../ai/writer/types'
import { isInCodeBlock } from '../inline/utils'
import { buildCodeBlockKeymapCommand } from './code-block-keymap'
import { installYjsSelectionPatch } from './yjs-selection-patch'
import { blockDragPlugin } from './block-drag-plugin'
import { createBlockIdPlugin } from '../notes/block-id-plugin'
import { createNotesViewPlugin } from '../notes/notes-plugin'
import { createNotesLifecyclePlugin } from '../notes/notes-lifecycle-plugin'
import { createNoteMarkerClipboardPlugin } from '../notes/note-marker-clipboard-plugin'

export type ProsemirrorMapping = Map<Y.AbstractType<unknown>, PMNode | PMNode[]>

interface CollaborationOptions {
  yjsFragment: Y.XmlFragment
  yjsMapping: ProsemirrorMapping
}

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
  aiWriterController?: AIWriterController
  collaboration?: CollaborationOptions
  getNotesMap?: () => Y.Map<unknown> | null
}

function buildCollaborationPlugins(options: CollaborationOptions): Plugin[] {
  return [ySyncPlugin(options.yjsFragment, { mapping: options.yjsMapping })]
}

function toggleMarkOutsideCodeBlock(markType: MarkType): Command {
  const command = toggleMark(markType)
  return (state, dispatch, view) => {
    if (view && isInCodeBlock(view)) return false
    return command(state, dispatch, view)
  }
}

function buildFormatKeymap() {
  const bindings: Record<string, Command> = {}

  const strong = schema.marks.strong
  const em = schema.marks.em
  const code = schema.marks.code

  if (strong) {
    bindings['Mod-b'] = toggleMarkOutsideCodeBlock(strong)
    bindings['Mod-B'] = toggleMarkOutsideCodeBlock(strong)
  }
  if (em) {
    bindings['Mod-i'] = toggleMarkOutsideCodeBlock(em)
    bindings['Mod-I'] = toggleMarkOutsideCodeBlock(em)
  }
  if (code) {
    bindings['Mod-e'] = toggleMarkOutsideCodeBlock(code)
    bindings['Mod-E'] = toggleMarkOutsideCodeBlock(code)
  }

  return keymap(bindings)
}

export function buildPlugins(options: BuildPluginsOptions = {}): Plugin[] {
  const { aiHandlers, aiWriterController, collaboration, getNotesMap } = options

  const effectiveHandlers: AIWriterActionHandlers = aiHandlers ?? {
    onAccept() {},
    onReject() {},
    onCancelAI() {},
  }

  const plugins: Plugin[] = []

  if (collaboration) {
    plugins.push(...buildCollaborationPlugins(collaboration))
  }

  plugins.push(createBlockIdPlugin())
  plugins.push(createNotesViewPlugin())
  if (getNotesMap) {
    plugins.push(createNotesLifecyclePlugin(getNotesMap))
  }
  plugins.push(createNoteMarkerClipboardPlugin())
  plugins.push(createAIWriterPlugin(effectiveHandlers))
  plugins.push(buildInputRules())

  if (collaboration) {
    plugins.push(yUndoPlugin())
    plugins.push(
      keymap(
        aiWriterController
          ? buildAIZoneUndoCommands(aiWriterController)
          : {
              'Mod-z': yUndo,
              'Mod-Shift-z': yRedo,
              'Mod-y': yRedo,
            }
      )
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

  plugins.push(buildFormatKeymap())
  plugins.push(keymap(buildCodeBlockKeymapCommand()))
  plugins.push(keymap(baseKeymap))
  plugins.push(blockDragPlugin)
  plugins.push(gapCursor())

  return plugins
}

/**
 * Finalizes collaboration-specific runtime behavior after EditorState creation.
 * Static plugin construction belongs in buildPlugins(); imperative third-party
 * binding patches belong here so the editor component only performs wiring.
 */
export function finalizeCollaborationState(state: EditorState): void {
  installYjsSelectionPatch(state)
}
