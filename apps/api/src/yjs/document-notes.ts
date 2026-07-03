import * as Y from 'yjs'
import {
  prosemirrorJSONToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror'
import {
  noteRecordToSnapshot,
  noteSnapshotToRecord,
  noteSchema,
  schema,
  type DocumentNoteRecord,
  type DocumentNoteSnapshot,
  type NoteAnchorKind,
} from '@lucentdocs/shared'
import type { JsonObject } from '@lucentdocs/shared'

export const NOTES_MAP_KEY = 'notes'

export interface SerializedNoteFromYjs {
  id: string
  anchorKind: NoteAnchorKind
  anchorId: string
  content: JsonObject
  authorUserId: string
  createdAt: number
  updatedAt: number
}

export function getNotesMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(NOTES_MAP_KEY)
}

export function serializeNotesMap(doc: Y.Doc): SerializedNoteFromYjs[] {
  const notesMap = getNotesMap(doc)
  const notes: SerializedNoteFromYjs[] = []

  notesMap.forEach((value, noteId) => {
    if (!(value instanceof Y.Map)) return

    const anchorKind = value.get('anchorKind')
    const anchorId = value.get('anchorId')
    const body = value.get('body')
    const authorUserId = value.get('authorUserId')
    if (typeof anchorKind !== 'string' || typeof anchorId !== 'string') return
    if (!(body instanceof Y.XmlFragment)) return
    if (typeof authorUserId !== 'string' || authorUserId.length === 0) return

    notes.push({
      id: typeof value.get('id') === 'string' ? (value.get('id') as string) : noteId,
      anchorKind: anchorKind as NoteAnchorKind,
      anchorId,
      content: yXmlFragmentToProseMirrorRootNode(body, noteSchema).toJSON() as JsonObject,
      authorUserId,
      createdAt: typeof value.get('createdAt') === 'number' ? (value.get('createdAt') as number) : Date.now(),
      updatedAt: typeof value.get('updatedAt') === 'number' ? (value.get('updatedAt') as number) : Date.now(),
    })
  })

  return notes.sort((left, right) => left.createdAt - right.createdAt)
}

export function notesMapToRecords(documentId: string, doc: Y.Doc): DocumentNoteRecord[] {
  return serializeNotesMap(doc).map((note) =>
    noteSnapshotToRecord(documentId, {
      ...note,
      content: note.content,
    })
  )
}

export function hydrateNotesMap(doc: Y.Doc, records: DocumentNoteRecord[]): void {
  const notesMap = getNotesMap(doc)
  const existingIds = [...notesMap.keys()]

  doc.transact(() => {
    for (const noteId of existingIds) {
      notesMap.delete(noteId)
    }

    for (const record of records) {
      const snapshot = noteRecordToSnapshot(record)
      const noteMap = new Y.Map<unknown>()
      const bodyFragment = new Y.XmlFragment()

      noteMap.set('id', snapshot.id)
      noteMap.set('anchorKind', snapshot.anchorKind)
      noteMap.set('anchorId', snapshot.anchorId)
      noteMap.set('authorUserId', snapshot.authorUserId)
      noteMap.set('createdAt', snapshot.createdAt)
      noteMap.set('updatedAt', snapshot.updatedAt)
      noteMap.set('body', bodyFragment)

      prosemirrorJSONToYXmlFragment(noteSchema, snapshot.content, bodyFragment)
      notesMap.set(snapshot.id, noteMap)
    }
  })
}

export function hydrateMainFragment(doc: Y.Doc, pmJson: JsonObject): void {
  const replacementDoc = new Y.Doc()
  try {
    prosemirrorJSONToYXmlFragment(schema, pmJson, replacementDoc.getXmlFragment('prosemirror'))
    const replacementState = Y.encodeStateAsUpdate(replacementDoc)
    const mainFragment = doc.getXmlFragment('prosemirror')
    if (mainFragment.length > 0) {
      mainFragment.delete(0, mainFragment.length)
    }
    Y.applyUpdate(doc, replacementState, 'hydrate-main-fragment')
  } finally {
    replacementDoc.destroy()
  }
}

export function snapshotsFromRecords(records: DocumentNoteRecord[]): DocumentNoteSnapshot[] {
  return records.map((record) => noteRecordToSnapshot(record))
}
