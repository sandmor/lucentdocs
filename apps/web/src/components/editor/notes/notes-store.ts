import * as Y from 'yjs'
import type { NoteAnchorKind } from '@lucentdocs/shared'

export interface DocumentNoteViewModel {
  id: string
  anchorKind: NoteAnchorKind
  anchorId: string
  authorUserId: string
  createdAt: number
  updatedAt: number
  body: Y.XmlFragment
  yMap: Y.Map<unknown>
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isAnchorKind(value: unknown): value is NoteAnchorKind {
  return value === 'block' || value === 'marker'
}

function parseNoteEntry(noteId: string, value: unknown): DocumentNoteViewModel | null {
  if (!(value instanceof Y.Map)) return null

  const anchorKind = value.get('anchorKind')
  const anchorId = readString(value.get('anchorId'))
  const body = value.get('body')
  const authorUserId = readString(value.get('authorUserId'))
  if (!isAnchorKind(anchorKind) || !anchorId) return null
  if (!(body instanceof Y.XmlFragment)) return null
  if (!authorUserId) return null

  return {
    id: readString(value.get('id')) ?? noteId,
    anchorKind,
    anchorId,
    authorUserId,
    createdAt: typeof value.get('createdAt') === 'number' ? (value.get('createdAt') as number) : Date.now(),
    updatedAt: typeof value.get('updatedAt') === 'number' ? (value.get('updatedAt') as number) : Date.now(),
    body,
    yMap: value,
  }
}

export function readNotesFromMap(notesMap: Y.Map<unknown>): DocumentNoteViewModel[] {
  const notes: DocumentNoteViewModel[] = []
  notesMap.forEach((value, noteId) => {
    const parsed = parseNoteEntry(noteId, value)
    if (parsed) notes.push(parsed)
  })
  return notes.sort((left, right) => left.createdAt - right.createdAt)
}

export function createNoteInMap(
  notesMap: Y.Map<unknown>,
  input: {
    anchorKind: NoteAnchorKind
    anchorId: string
    authorUserId: string
    body?: Y.XmlFragment
  }
): DocumentNoteViewModel {
  const id = crypto.randomUUID()
  const now = Date.now()
  const noteMap = new Y.Map<unknown>()
  const body = input.body ?? new Y.XmlFragment()

  noteMap.set('id', id)
  noteMap.set('anchorKind', input.anchorKind)
  noteMap.set('anchorId', input.anchorId)
  noteMap.set('authorUserId', input.authorUserId)
  noteMap.set('createdAt', now)
  noteMap.set('updatedAt', now)
  noteMap.set('body', body)

  notesMap.set(id, noteMap)

  return {
    id,
    anchorKind: input.anchorKind,
    anchorId: input.anchorId,
    authorUserId: input.authorUserId,
    createdAt: now,
    updatedAt: now,
    body,
    yMap: noteMap,
  }
}

export function deleteNoteFromMap(notesMap: Y.Map<unknown>, noteId: string): void {
  notesMap.delete(noteId)
}

export function deleteNotesForAnchor(notesMap: Y.Map<unknown>, anchorId: string): string[] {
  const deleted: string[] = []
  notesMap.forEach((value, noteId) => {
    if (!(value instanceof Y.Map)) return
    if (value.get('anchorId') === anchorId) {
      notesMap.delete(noteId)
      deleted.push(noteId)
    }
  })
  return deleted
}

export function countNotesForAnchor(notesMap: Y.Map<unknown>, anchorId: string): number {
  let count = 0
  notesMap.forEach((value) => {
    if (!(value instanceof Y.Map)) return
    if (value.get('anchorId') === anchorId) count += 1
  })
  return count
}

export function listNotesForAnchor(
  notesMap: Y.Map<unknown>,
  anchorId: string
): DocumentNoteViewModel[] {
  return readNotesFromMap(notesMap).filter((note) => note.anchorId === anchorId)
}

export interface NoteAnchorRef {
  noteId: string
  anchorKind: NoteAnchorKind
  anchorId: string
}

export function reanchorNotesForAnchor(
  notesMap: Y.Map<unknown>,
  fromAnchorId: string,
  to: { anchorKind: NoteAnchorKind; anchorId: string },
  filter?: { anchorKind?: NoteAnchorKind }
): NoteAnchorRef[] {
  const previous: NoteAnchorRef[] = []
  const now = Date.now()

  notesMap.forEach((value, noteId) => {
    if (!(value instanceof Y.Map)) return
    if (value.get('anchorId') !== fromAnchorId) return
    if (filter?.anchorKind !== undefined && value.get('anchorKind') !== filter.anchorKind) return

    previous.push({
      noteId,
      anchorKind: value.get('anchorKind') as NoteAnchorKind,
      anchorId: value.get('anchorId') as string,
    })
    value.set('anchorKind', to.anchorKind)
    value.set('anchorId', to.anchorId)
    value.set('updatedAt', now)
  })

  return previous
}

export function restoreNoteAnchors(notesMap: Y.Map<unknown>, refs: readonly NoteAnchorRef[]): void {
  const now = Date.now()
  for (const ref of refs) {
    const noteMap = notesMap.get(ref.noteId)
    if (!(noteMap instanceof Y.Map)) continue
    noteMap.set('anchorKind', ref.anchorKind)
    noteMap.set('anchorId', ref.anchorId)
    noteMap.set('updatedAt', now)
  }
}
