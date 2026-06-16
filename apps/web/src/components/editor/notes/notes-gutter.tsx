import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import type * as Y from 'yjs'
import { Trash2, X } from 'lucide-react'
import { useIsCoarsePointer } from '../inline/hooks'
import { subscribeEditorView } from '../prosemirror/view-store'
import {
  computeRightGutterContainerX,
  EDITOR_NOTE_CARD_WIDTH,
  getEditorContentRect,
  stackSideElements,
} from '../side-elements/layout'
import { useDocumentNotes } from './use-document-notes'
import type { DocumentNoteViewModel } from './notes-store'
import { deleteNoteFromMap } from './notes-store'
import {
  buildTopLevelBlockIdIndex,
  groupNotesByBlockId,
  resolveNoteAnchorLayout,
} from './note-anchor'
import { NoteEditor } from './note-editor'
import { buildNoteDecorations, updateNoteDecorations } from './notes-plugin'
import { NoteSheet } from './note-sheet'
import { NoteSideOrb } from './note-side-orb'
import { useNoteAuthorLabels } from './use-note-author-labels'

interface NotesGutterProps {
  view: EditorView | null
  container: HTMLElement | null
  notesMap: Y.Map<unknown> | null
  projectId?: string
  currentUserId: string
}

interface NoteCardLayout {
  note: DocumentNoteViewModel
  left: number
  top: number
  anchorTop: number
  height: number
}

interface MobileBlockMarkerLayout {
  blockId: string
  left: number
  top: number
  count: number
}

const ORB_SIZE = 40
const EXPANDED_CARD_HEIGHT = 200

export function NotesGutter({
  view,
  container,
  notesMap,
  projectId,
  currentUserId,
}: NotesGutterProps) {
  const notes = useDocumentNotes(notesMap)
  const isCoarsePointer = useIsCoarsePointer()
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null)
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null)
  const [sheetBlockId, setSheetBlockId] = useState<string | null>(null)
  const [layoutEpoch, setLayoutEpoch] = useState(0)

  const authorLabels = useNoteAuthorLabels(
    notes.map((note) => note.authorUserId),
    currentUserId,
    projectId
  )

  const orphanedNotes = useMemo(() => {
    if (!view) return notes
    const index = buildTopLevelBlockIdIndex(view)
    return notes.filter((note) => !index.has(note.blockId))
  }, [notes, view, layoutEpoch])

  const anchoredNotes = useMemo(() => {
    if (!view) return []
    const index = buildTopLevelBlockIdIndex(view)
    return notes.filter((note) => index.has(note.blockId))
  }, [notes, view, layoutEpoch])

  const activeHighlightedBlockId = useMemo(() => {
    if (!highlightedBlockId) return null
    return notes.some((note) => note.blockId === highlightedBlockId) ? highlightedBlockId : null
  }, [notes, highlightedBlockId])

  const activeExpandedNoteId = useMemo(() => {
    if (!expandedNoteId) return null
    return notes.some((note) => note.id === expandedNoteId) ? expandedNoteId : null
  }, [notes, expandedNoteId])

  const layoutFrameRef = useRef(0)

  useEffect(() => {
    if (!view) return

    const scheduleRefresh = () => {
      cancelAnimationFrame(layoutFrameRef.current)
      layoutFrameRef.current = requestAnimationFrame(() => {
        setLayoutEpoch((value) => value + 1)
      })
    }

    const unsubscribe = subscribeEditorView(view, scheduleRefresh)
    const resizeObserver = new ResizeObserver(scheduleRefresh)
    resizeObserver.observe(view.dom)
    if (container) resizeObserver.observe(container)
    window.addEventListener('resize', scheduleRefresh)
    window.addEventListener('scroll', scheduleRefresh, true)

    return () => {
      cancelAnimationFrame(layoutFrameRef.current)
      unsubscribe()
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleRefresh)
      window.removeEventListener('scroll', scheduleRefresh, true)
    }
  }, [view, container])

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
  }, [view, container, isCoarsePointer, notes, layoutEpoch])

  const cards = useMemo((): NoteCardLayout[] => {
    if (!view || !container || isCoarsePointer) return []

    const containerRect = container.getBoundingClientRect()
    const editorRect = getEditorContentRect(view)
    const left = computeRightGutterContainerX(editorRect, containerRect)
    const blockIndex = buildTopLevelBlockIdIndex(view)

    const desired = anchoredNotes.map((note) => {
      const anchor = resolveNoteAnchorLayout(view, note.blockId, note.placement, blockIndex)
      const isExpanded = activeExpandedNoteId === note.id
      const height = isExpanded ? EXPANDED_CARD_HEIGHT : ORB_SIZE
      return {
        note,
        left,
        desiredTop: (anchor?.top ?? 0) - containerRect.top,
        height,
        anchorTop: anchor?.top ?? 0,
      }
    })

    const stacked = stackSideElements(
      desired.map((item) => ({
        id: item.note.id,
        desiredTop: item.desiredTop,
        height: item.height,
      }))
    )

    return desired.map((item) => ({
      note: item.note,
      left: item.left,
      top: stacked.get(item.note.id) ?? item.desiredTop,
      anchorTop: item.anchorTop,
      height: item.height,
    }))
  }, [view, container, isCoarsePointer, anchoredNotes, activeExpandedNoteId, layoutEpoch])

  const handleDeleteNote = (note: DocumentNoteViewModel) => {
    if (!notesMap) return
    deleteNoteFromMap(notesMap, note.id)
  }

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

      {!isCoarsePointer &&
        cards.map(({ note, left, top, height }) => {
          const isExpanded = activeExpandedNoteId === note.id

          if (!isExpanded) {
            return (
              <div
                key={note.id}
                className="pointer-events-auto absolute z-58"
                style={{
                  left: `${Math.round(left)}px`,
                  top: `${Math.round(top)}px`,
                  height: `${ORB_SIZE}px`,
                }}
                onMouseEnter={() => setHighlightedBlockId(note.blockId)}
                onMouseLeave={() => setHighlightedBlockId(null)}
              >
                <NoteSideOrb
                  title="Expand note"
                  onClick={() => setExpandedNoteId(note.id)}
                />
              </div>
            )
          }

          return (
            <div
              key={note.id}
              className="note-card pointer-events-auto absolute z-58 rounded-lg border border-border/70 bg-card/95 p-3 shadow-sm backdrop-blur-sm"
              style={{
                left: `${Math.round(left)}px`,
                top: `${Math.round(top)}px`,
                width: `${EDITOR_NOTE_CARD_WIDTH}px`,
                minHeight: `${height}px`,
              }}
              onMouseEnter={() => setHighlightedBlockId(note.blockId)}
              onMouseLeave={() => setHighlightedBlockId(null)}
            >
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
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label="Collapse note"
                    onClick={() => setExpandedNoteId(null)}
                  >
                    <X className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label="Delete note"
                    onClick={() => handleDeleteNote(note)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              <NoteEditor body={note.body} autoFocus />
            </div>
          )
        })}

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
                <NoteEditor body={note.body} />
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
