import { useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { readNotesFromMap, type DocumentNoteViewModel } from './notes-store'

const EMPTY_NOTES: DocumentNoteViewModel[] = []

interface NotesSnapshotCacheEntry {
  signature: string
  notes: DocumentNoteViewModel[]
}

const notesSnapshotCache = new WeakMap<Y.Map<unknown>, NotesSnapshotCacheEntry>()

function buildNotesSignature(notes: DocumentNoteViewModel[]): string {
  return notes
    .map((note) => `${note.id}:${note.updatedAt}:${note.anchorId}:${note.anchorKind}`)
    .join('|')
}

/**
 * Returns a stable notes array reference while the underlying Yjs data is unchanged.
 * Required for useSyncExternalStore — a fresh array each snapshot causes infinite re-renders.
 */
export function getNotesSnapshot(notesMap: Y.Map<unknown> | null): DocumentNoteViewModel[] {
  if (!notesMap) return EMPTY_NOTES

  const nextNotes = readNotesFromMap(notesMap)
  const signature = buildNotesSignature(nextNotes)
  const cached = notesSnapshotCache.get(notesMap)

  if (cached && cached.signature === signature) {
    return cached.notes
  }

  const entry = { signature, notes: nextNotes }
  notesSnapshotCache.set(notesMap, entry)
  return entry.notes
}

export function subscribeNotesMap(
  notesMap: Y.Map<unknown> | null,
  onChange: () => void
): () => void {
  if (!notesMap) return () => {}

  const handler = () => {
    onChange()
  }

  notesMap.observeDeep(handler)
  return () => {
    notesMap.unobserveDeep(handler)
  }
}

export function useDocumentNotes(notesMap: Y.Map<unknown> | null): DocumentNoteViewModel[] {
  return useSyncExternalStore(
    (onChange) => subscribeNotesMap(notesMap, onChange),
    () => getNotesSnapshot(notesMap),
    () => EMPTY_NOTES
  )
}
