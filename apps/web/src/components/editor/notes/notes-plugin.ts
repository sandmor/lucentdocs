import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'
import type { DocumentNoteViewModel } from './notes-store'
import { buildTopLevelBlockIdIndex } from './note-anchor'

export const notesPluginKey = new PluginKey<DecorationSet>('notes-view')

interface BuildDecorationsOptions {
  notes: DocumentNoteViewModel[]
  highlightedBlockId: string | null
}

export function buildNoteDecorations(
  view: EditorView,
  options: BuildDecorationsOptions
): DecorationSet {
  const decorations: Decoration[] = []
  const blockIndex = buildTopLevelBlockIdIndex(view)

  if (options.highlightedBlockId) {
    const pos = blockIndex.get(options.highlightedBlockId)
    if (pos !== undefined) {
      const node = view.state.doc.nodeAt(pos)
      if (node) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: 'note-anchor-highlight',
          })
        )
      }
    }
  }

  return DecorationSet.create(view.state.doc, decorations)
}

export function createNotesViewPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: notesPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, value) {
        const meta = tr.getMeta(notesPluginKey) as DecorationSet | undefined
        if (meta) return meta
        if (tr.docChanged) return value.map(tr.mapping, tr.doc)
        return value
      },
    },
    props: {
      decorations(state) {
        return notesPluginKey.getState(state) ?? DecorationSet.empty
      },
    },
  })
}

const lastDecorationKeys = new WeakMap<EditorView, string>()

export function updateNoteDecorations(
  view: EditorView,
  decorations: DecorationSet,
  cacheKey: string
): void {
  if (lastDecorationKeys.get(view) === cacheKey) return
  lastDecorationKeys.set(view, cacheKey)
  view.dispatch(view.state.tr.setMeta(notesPluginKey, decorations).setMeta('addToHistory', false))
}
