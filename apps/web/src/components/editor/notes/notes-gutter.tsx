import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import type * as Y from 'yjs'
import { Trash2 } from 'lucide-react'
import { useIsCoarsePointer } from '../inline/hooks'
import {
  computeRightGutterContainerX,
  EDITOR_NOTE_CARD_WIDTH,
  getEditorContentRect,
} from '../side-elements/layout'
import { SideElement, SideElementLayer } from '../side-elements/side-element'
import { useSideElementsStore } from '../side-elements/use-side-elements-store'
import { useDocumentNotes } from './use-document-notes'
import type { DocumentNoteViewModel } from './notes-store'
import { deleteNoteFromMap } from './notes-store'
import {
  buildTopLevelBlockIdIndex,
  groupNotesByBlockId,
  resolveNoteAnchorLayout,
} from './note-anchor'
import { NoteEditor } from './note-editor'
import { NoteCard } from './note-card'
import { buildNoteDecorations, updateNoteDecorations } from './notes-plugin'
import { NoteSheet } from './note-sheet'
import { NoteSideOrb } from './note-side-orb'
import { useNoteAuthorLabels } from './use-note-author-labels'

const ORB_SIZE = 40

interface NotesGutterProps {
  view: EditorView | null
  container: HTMLElement | null
  notesMap: Y.Map<unknown> | null
  projectId?: string
  currentUserId: string
  justCreatedNote?: { id: string; blockId: string } | null
  onJustCreatedNoteHandled?: () => void
}

interface MobileBlockMarkerLayout {
  blockId: string
  left: number
  top: number
  count: number
}

function addExpandedId(prev: Set<string>, id: string): Set<string> {
  if (prev.has(id)) return prev
  const next = new Set(prev)
  next.add(id)
  return next
}

function removeExpandedId(prev: Set<string>, id: string): Set<string> {
  if (!prev.has(id)) return prev
  const next = new Set(prev)
  next.delete(id)
  return next
}

export function NotesGutter({
  view,
  container,
  notesMap,
  projectId,
  currentUserId,
  justCreatedNote,
  onJustCreatedNoteHandled,
}: NotesGutterProps) {
  const notes = useDocumentNotes(notesMap)
  const isCoarsePointer = useIsCoarsePointer()
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(() => new Set())
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null)
  const [sheetBlockId, setSheetBlockId] = useState<string | null>(null)
  const { layoutEpoch } = useSideElementsStore()

  const authorLabels = useNoteAuthorLabels(
    notes.map((note) => note.authorUserId),
    currentUserId,
    projectId
  )

  const orphanedNotes = useMemo(() => {
    if (!view) return notes
    const index = buildTopLevelBlockIdIndex(view)
    return notes.filter((note) => !index.has(note.blockId))
    // layoutEpoch triggers recompute when editor scrolls/resizes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, view, layoutEpoch])

  const anchoredNotes = useMemo(() => {
    if (!view) return []
    const index = buildTopLevelBlockIdIndex(view)
    return notes.filter((note) => index.has(note.blockId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, view, layoutEpoch])

  const activeHighlightedBlockId = useMemo(() => {
    if (!highlightedBlockId) return null
    return notes.some((note) => note.blockId === highlightedBlockId) ? highlightedBlockId : null
  }, [notes, highlightedBlockId])

  const activeExpandedNoteIds = useMemo(() => {
    const noteIds = new Set(notes.map((note) => note.id))
    return new Set([...expandedNoteIds].filter((id) => noteIds.has(id)))
  }, [notes, expandedNoteIds])

  const decorationCacheKey = useMemo(
    () =>
      [activeHighlightedBlockId ?? '', notes.map((note) => `${note.id}:${note.updatedAt}:${note.blockId}`).join('|')].join(
        ';'
      ),
    [notes, activeHighlightedBlockId]
  )

  const openSheet = useCallback((blockId: string) => {
    setSheetBlockId(blockId)
  }, [])

  useEffect(() => {
    if (!view) return

    const decorations = buildNoteDecorations(view, {
      notes,
      highlightedBlockId: activeHighlightedBlockId,
    })
    updateNoteDecorations(view, decorations, decorationCacheKey)
  }, [view, notes, activeHighlightedBlockId, decorationCacheKey])

  const [prevJustCreatedNote, setPrevJustCreatedNote] = useState(justCreatedNote)
  if (justCreatedNote !== prevJustCreatedNote) {
    setPrevJustCreatedNote(justCreatedNote)
    if (justCreatedNote) {
      if (isCoarsePointer) {
        setSheetBlockId(justCreatedNote.blockId)
      } else {
        setExpandedNoteIds((prev) => addExpandedId(prev, justCreatedNote.id))
      }
    }
  }

  const onJustCreatedNoteHandledRef = useRef(onJustCreatedNoteHandled)
  useEffect(() => {
    onJustCreatedNoteHandledRef.current = onJustCreatedNoteHandled
  })
  useEffect(() => {
    if (justCreatedNote) onJustCreatedNoteHandledRef.current?.()
  }, [justCreatedNote])

  const mobileMarkers = useMemo((): MobileBlockMarkerLayout[] => {
    if (!view || !container || !isCoarsePointer) return []

    const containerRect = container.getBoundingClientRect()
    const blockIndex = buildTopLevelBlockIdIndex(view)
    const grouped = groupNotesByBlockId(notes)
    const markers: MobileBlockMarkerLayout[] = []

    for (const [blockId, blockNotes] of grouped) {
      const pos = blockIndex.get(blockId)
      if (pos === undefined) continue
      const dom = view.nodeDOM(pos)
      if (!(dom instanceof HTMLElement)) continue

      const rect = dom.getBoundingClientRect()
      markers.push({
        blockId,
        left: rect.right - containerRect.left + 4,
        top: rect.top - containerRect.top + Math.max(0, (rect.height - ORB_SIZE) / 2),
        count: blockNotes.length,
      })
    }

    return markers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, container, isCoarsePointer, notes, layoutEpoch])

  const desktopNoteLayouts = useMemo(() => {
    if (!view || !container || isCoarsePointer) return []

    const containerRect = container.getBoundingClientRect()
    const editorRect = getEditorContentRect(view)
    const left = computeRightGutterContainerX(editorRect, containerRect)
    const blockIndex = buildTopLevelBlockIdIndex(view)

    return anchoredNotes.map((note) => {
      const anchor = resolveNoteAnchorLayout(view, note.blockId, note.placement, blockIndex)
      return {
        note,
        left,
        desiredTop: (anchor?.top ?? 0) - containerRect.top,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, container, isCoarsePointer, anchoredNotes, layoutEpoch])

  const handleDeleteNote = (note: DocumentNoteViewModel) => {
    if (!notesMap) return
    deleteNoteFromMap(notesMap, note.id)
    setExpandedNoteIds((prev) => removeExpandedId(prev, note.id))
  }

  const expandNote = useCallback((noteId: string) => {
    setExpandedNoteIds((prev) => addExpandedId(prev, noteId))
  }, [])

  const collapseNote = useCallback((noteId: string) => {
    setExpandedNoteIds((prev) => removeExpandedId(prev, noteId))
  }, [])

  if (!view || !notesMap) return null

  return (
    <>
      {isCoarsePointer &&
        mobileMarkers.map((marker) => (
          <div
            key={marker.blockId}
            className="pointer-events-auto absolute z-58"
            style={{
              left: `${Math.round(marker.left)}px`,
              top: `${Math.round(marker.top)}px`,
            }}
          >
            <NoteSideOrb
              count={marker.count}
              title={`${marker.count} note${marker.count === 1 ? '' : 's'}`}
              onClick={() => openSheet(marker.blockId)}
            />
          </div>
        ))}

      <SideElementLayer>
        {!isCoarsePointer &&
          desktopNoteLayouts.map(({ note, left, desiredTop }) => (
            <SideElement
              key={note.id}
              id={`note-${note.id}`}
              gutter="right"
              desiredTop={desiredTop}
              left={left}
              order={note.createdAt}
              measureTarget="child"
            >
              <NoteCard
                note={note}
                authorLabel={authorLabels.getLabel(note.authorUserId)}
                authorColor={authorLabels.getColor(note.authorUserId)}
                isExpanded={activeExpandedNoteIds.has(note.id)}
                isNew={justCreatedNote?.id === note.id}
                onExpand={() => expandNote(note.id)}
                onCollapse={() => collapseNote(note.id)}
                onDelete={() => handleDeleteNote(note)}
                onMouseEnter={() => setHighlightedBlockId(note.blockId)}
                onMouseLeave={() => setHighlightedBlockId(null)}
              />
            </SideElement>
          ))}
      </SideElementLayer>

      {!isCoarsePointer && orphanedNotes.length > 0 && container && (
        <div
          className="note-card pointer-events-auto absolute z-58 w-[220px] rounded-lg border border-dashed border-border/70 bg-card/90 p-3 text-xs text-muted-foreground shadow-sm"
          style={{
            left: `${Math.round(
              computeRightGutterContainerX(
                getEditorContentRect(view),
                container.getBoundingClientRect()
              )
            )}px`,
            bottom: '12px',
            width: `${EDITOR_NOTE_CARD_WIDTH}px`,
          }}
        >
          <div className="mb-2 font-medium text-foreground/80">Unanchored notes</div>
          <div className="space-y-2">
            {orphanedNotes.map((note) => (
              <div key={note.id} className="rounded border border-border/60 p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: authorLabels.getColor(note.authorUserId) }}
                    />
                    <span className="truncate text-xs font-medium text-foreground/80">
                      {authorLabels.getLabel(note.authorUserId)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label="Delete note"
                    onClick={() => handleDeleteNote(note)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <NoteEditor body={note.body} yMap={note.yMap} />
              </div>
            ))}
          </div>
        </div>
      )}

      {isCoarsePointer && sheetBlockId && (
        <NoteSheet
          blockId={sheetBlockId}
          notes={notes.filter((note) => note.blockId === sheetBlockId)}
          notesMap={notesMap}
          projectId={projectId}
          currentUserId={currentUserId}
          onClose={() => setSheetBlockId(null)}
        />
      )}
    </>
  )
}
