import * as Y from 'yjs'
import type { NotePlacement } from '@lucentdocs/shared'

export interface DocumentNoteViewModel {
  id: string
  blockId: string
  placement: NotePlacement
  authorUserId: string
  createdAt: number
  updatedAt: number
  body: Y.XmlFragment
  yMap: Y.Map<unknown>
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parseNoteEntry(noteId: string, value: unknown): DocumentNoteViewModel | null {
  if (!(value instanceof Y.Map)) return null

  const blockId = readString(value.get('blockId'))
  const placement = value.get('placement')
  const body = value.get('body')
  const authorUserId = readString(value.get('authorUserId'))
  if (!blockId || typeof placement !== 'string') return null
  if (!(body instanceof Y.XmlFragment)) return null
  if (!authorUserId) return null

  return {
    id: readString(value.get('id')) ?? noteId,
    blockId,
    placement: placement as NotePlacement,
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
    blockId: string
    placement: NotePlacement
    authorUserId: string
  }
): DocumentNoteViewModel {
  const id = crypto.randomUUID()
  const now = Date.now()
  const noteMap = new Y.Map<unknown>()
  const body = new Y.XmlFragment()

  noteMap.set('id', id)
  noteMap.set('blockId', input.blockId)
  noteMap.set('placement', input.placement)
  noteMap.set('authorUserId', input.authorUserId)
  noteMap.set('createdAt', now)
  noteMap.set('updatedAt', now)
  noteMap.set('body', body)

  notesMap.set(id, noteMap)

  return {
    id,
    blockId: input.blockId,
    placement: input.placement,
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
