import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type * as Y from 'yjs'
import {
  collectDeletedTopLevelBlockIds,
  createRemoveOrphanMarkersTransaction,
  reconcileNotesAfterBlockDeletes,
  removeOrphanMarkers,
} from './note-reconcile'

export const notesLifecyclePluginKey = new PluginKey('notes-lifecycle')

export function createNotesLifecyclePlugin(getNotesMap: () => Y.Map<unknown> | null): Plugin {
  let activeView: EditorView | null = null
  let observedMap: Y.Map<unknown> | null = null

  const onNotesMapChange = () => {
    if (activeView && observedMap) {
      removeOrphanMarkers(activeView, observedMap)
    }
  }

  const bindNotesMap = () => {
    const notesMap = getNotesMap()
    if (notesMap === observedMap) return
    observedMap?.unobserve(onNotesMapChange)
    observedMap = notesMap
    notesMap?.observe(onNotesMapChange)
  }

  return new Plugin({
    key: notesLifecyclePluginKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null

      const notesMap = getNotesMap()
      if (!notesMap) return null

      const deletedIds = collectDeletedTopLevelBlockIds(oldState.doc, newState.doc)
      if (deletedIds.length > 0) {
        reconcileNotesAfterBlockDeletes(notesMap, deletedIds)
      }

      return createRemoveOrphanMarkersTransaction(newState, notesMap)
    },
    view(view) {
      activeView = view
      bindNotesMap()
      return {
        update(nextView) {
          activeView = nextView
          bindNotesMap()
        },
        destroy() {
          observedMap?.unobserve(onNotesMapChange)
          observedMap = null
          activeView = null
        },
      }
    },
  })
}
