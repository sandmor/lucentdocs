import type { Node as PMNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type * as Y from 'yjs'
import { schema } from '@lucentdocs/shared'
import {
  countNotesForAnchor,
  deleteNoteFromMap,
  readNotesFromMap,
  deleteNotesForAnchor,
} from './notes-store'
import { buildTopLevelBlockIdIndex, buildTopLevelBlockIdIndexFromDoc } from './note-anchor'

export function deleteNoteAndReconcileMarker(
  view: EditorView | null,
  notesMap: Y.Map<unknown>,
  noteId: string
): void {
  const note = readNotesFromMap(notesMap).find((entry) => entry.id === noteId)
  if (!note) return

  const { anchorKind, anchorId } = note
  deleteNoteFromMap(notesMap, noteId)

  if (anchorKind !== 'marker' || countNotesForAnchor(notesMap, anchorId) > 0) {
    return
  }

  if (view) {
    removeMarkerBlockById(view, anchorId)
  }
}

function removeMarkerBlockById(view: EditorView, markerId: string): void {
  const index = buildTopLevelBlockIdIndex(view)
  const pos = index.get(markerId)
  if (pos === undefined) return

  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'note_marker') return

  const tr = view.state.tr.delete(pos, pos + node.nodeSize)
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

export function reconcileNotesAfterBlockDeletes(
  notesMap: Y.Map<unknown>,
  deletedBlockIds: string[]
): void {
  if (deletedBlockIds.length === 0) return

  for (const anchorId of deletedBlockIds) {
    deleteNotesForAnchor(notesMap, anchorId)
  }
}

export function collectDeletedTopLevelBlockIds(
  oldDoc: import('prosemirror-model').Node,
  newDoc: import('prosemirror-model').Node
): string[] {
  const oldIds = new Set<string>()
  const newIds = new Set<string>()

  oldDoc.forEach((node) => {
    const id = node.attrs.id
    if (typeof id === 'string' && id.length > 0) oldIds.add(id)
  })

  newDoc.forEach((node) => {
    const id = node.attrs.id
    if (typeof id === 'string' && id.length > 0) newIds.add(id)
  })

  return [...oldIds].filter((id) => !newIds.has(id))
}

export function findOrphanMarkerIds(doc: PMNode, notesMap: Y.Map<unknown>): string[] {
  const orphanMarkerIds: string[] = []
  const notes = readNotesFromMap(notesMap)

  doc.forEach((node) => {
    if (node.type.name !== 'note_marker') return
    const id = node.attrs.id
    if (typeof id !== 'string' || id.length === 0) return
    const hasNotes = notes.some((note) => note.anchorId === id)
    if (!hasNotes) orphanMarkerIds.push(id)
  })

  return orphanMarkerIds
}

export function createRemoveOrphanMarkersTransaction(
  state: EditorState,
  notesMap: Y.Map<unknown>
): Transaction | null {
  const orphanIds = findOrphanMarkerIds(state.doc, notesMap)
  if (orphanIds.length === 0) return null

  const index = buildTopLevelBlockIdIndexFromDoc(state.doc)
  const deletions: Array<{ pos: number; nodeSize: number }> = []

  for (const markerId of orphanIds) {
    const pos = index.get(markerId)
    if (pos === undefined) continue
    const node = state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'note_marker') continue
    deletions.push({ pos, nodeSize: node.nodeSize })
  }

  if (deletions.length === 0) return null

  deletions.sort((left, right) => right.pos - left.pos)
  let tr = state.tr
  for (const { pos, nodeSize } of deletions) {
    tr = tr.delete(pos, pos + nodeSize)
  }

  return tr.setMeta('addToHistory', false)
}

export function removeOrphanMarkers(view: EditorView, notesMap: Y.Map<unknown>): void {
  const tr = createRemoveOrphanMarkersTransaction(view.state, notesMap)
  if (tr) view.dispatch(tr)
}

export function isNoteMarkerNode(node: { type: { name: string } }): boolean {
  return node.type.name === 'note_marker'
}

export function createNoteMarkerNode(markerId?: string) {
  const noteMarker = schema.nodes.note_marker
  if (!noteMarker) return null
  return noteMarker.create({ id: markerId ?? crypto.randomUUID() })
}
