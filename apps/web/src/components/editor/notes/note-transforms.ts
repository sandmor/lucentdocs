import { NodeSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type * as Y from 'yjs'
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror'
import { noteSchema, schema } from '@lucentdocs/shared'
import type { ActiveBlockInfo } from '../prosemirror/block-resolve'
import { isListBlockType } from '../prosemirror/block-resolve'
import { getBlockIdAtPos } from './block-id-plugin'
import {
  createNoteInMap,
  deleteNoteFromMap,
  reanchorNotesForAnchor,
  restoreNoteAnchors,
} from './notes-store'

const TURN_INTO_NOTE_TYPES = new Set(['paragraph', 'heading', 'code_block'])

function generateMarkerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`
}

export function supportsTurnIntoNote(node: { type: { name: string } }): boolean {
  return TURN_INTO_NOTE_TYPES.has(node.type.name)
}

function blockContentToNoteBodyJson(info: ActiveBlockInfo) {
  return {
    type: 'doc',
    content: [info.node.toJSON()],
  }
}

function resolveBlockAnchorId(view: EditorView, info: ActiveBlockInfo): string | null {
  return typeof info.node.attrs.id === 'string' && info.node.attrs.id.length > 0
    ? info.node.attrs.id
    : getBlockIdAtPos(view.state.doc, info.pos + 1)
}

export function turnBlockIntoNote(
  view: EditorView,
  info: ActiveBlockInfo,
  notesMap: Y.Map<unknown>,
  authorUserId: string
): { id: string; anchorId: string } | null {
  const { node, pos } = info
  if (node.type.name === 'note_marker' || isListBlockType(node.type.name)) return null
  if (!supportsTurnIntoNote(node)) return null

  const noteMarkerType = schema.nodes.note_marker
  if (!noteMarkerType) return null

  const markerId = generateMarkerId()
  const blockAnchorId = resolveBlockAnchorId(view, info)
  const bodyJson = blockContentToNoteBodyJson(info)

  const marker = noteMarkerType.create({ id: markerId })
  const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, marker)
  tr.setSelection(NodeSelection.create(tr.doc, pos))
  tr.scrollIntoView()

  let createdNoteId: string | null = null
  let migratedAnchors: ReturnType<typeof reanchorNotesForAnchor> = []

  try {
    const note = createNoteInMap(notesMap, {
      anchorKind: 'marker',
      anchorId: markerId,
      authorUserId,
    })
    createdNoteId = note.id
    prosemirrorJSONToYXmlFragment(noteSchema, bodyJson, note.body)

    if (blockAnchorId) {
      migratedAnchors = reanchorNotesForAnchor(
        notesMap,
        blockAnchorId,
        { anchorKind: 'marker', anchorId: markerId },
        { anchorKind: 'block' }
      )
    }

    view.dispatch(tr)
  } catch {
    if (createdNoteId) deleteNoteFromMap(notesMap, createdNoteId)
    if (migratedAnchors.length > 0) restoreNoteAnchors(notesMap, migratedAnchors)
    return null
  }

  view.focus()
  return { id: createdNoteId!, anchorId: markerId }
}
