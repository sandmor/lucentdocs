import { useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EditorView } from 'prosemirror-view'
import type * as Y from 'yjs'
import type { NoteAnchorKind } from '@lucentdocs/shared'
import type { DocumentNoteViewModel } from './notes-store'
import { createNoteInMap } from './notes-store'
import { deleteNoteAndReconcileMarker } from './note-reconcile'
import { NoteEditor, type NoteEditorHandle } from './note-editor'
import { useNoteAuthorLabels } from './use-note-author-labels'
import { cn } from '@/lib/utils'
import { useRef, useState } from 'react'

interface NoteSheetProps {
  anchorId: string
  anchorKind: NoteAnchorKind
  notes: DocumentNoteViewModel[]
  notesMap: Y.Map<unknown>
  view: EditorView | null
  projectId?: string
  currentUserId: string
  onClose: () => void
}

function NoteSheetItem({
  note,
  authorLabel,
  authorColor,
  onDelete,
}: {
  note: DocumentNoteViewModel
  authorLabel: string
  authorColor: string
  onDelete: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const editorRef = useRef<NoteEditorHandle>(null)

  const handleBodyClick = useCallback(() => {
    if (!isEditing) {
      setIsEditing(true)
      requestAnimationFrame(() => editorRef.current?.focus())
    }
  }, [isEditing])

  const handleBlur = useCallback(() => {
    requestAnimationFrame(() => {
      setIsEditing(false)
    })
  }, [])

  return (
    <div className="rounded-lg border border-border/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: authorColor }}
          />
          <span className="text-sm font-medium">{authorLabel}</span>
        </div>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete note"
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div
        className={cn(
          isEditing ? 'min-h-16' : 'min-h-0',
          !isEditing && 'cursor-text'
        )}
        onClick={handleBodyClick}
      >
        <NoteEditor
          ref={editorRef}
          body={note.body}
          yMap={note.yMap}
          editable={isEditing}
          onFocus={() => setIsEditing(true)}
          onBlur={handleBlur}
        />
      </div>

      {!isEditing && (
        <div className="pointer-events-none mt-1 select-none text-right text-[10px] text-muted-foreground/40">
          tap to edit
        </div>
      )}
    </div>
  )
}

export function NoteSheet({
  anchorId,
  anchorKind,
  notes,
  notesMap,
  view,
  projectId,
  currentUserId,
  onClose,
}: NoteSheetProps) {
  const authorLabels = useNoteAuthorLabels(
    notes.map((note) => note.authorUserId),
    currentUserId,
    projectId
  )

  const handleAddNote = useCallback(() => {
    createNoteInMap(notesMap, {
      anchorKind,
      anchorId,
      authorUserId: currentUserId,
    })
  }, [notesMap, anchorId, anchorKind, currentUserId])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="top-auto bottom-0 max-h-[75vh] translate-y-0 rounded-b-none sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Notes</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[58vh] flex-col gap-3 overflow-y-auto pb-1">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes for this anchor yet.</p>
          ) : (
            notes.map((note) => (
              <NoteSheetItem
                key={note.id}
                note={note}
                authorLabel={authorLabels.getLabel(note.authorUserId)}
                authorColor={authorLabels.getColor(note.authorUserId)}
                onDelete={() => deleteNoteAndReconcileMarker(view, notesMap, note.id)}
              />
            ))
          )}
        </div>
        <div className="pt-1 border-t border-border/50">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={handleAddNote}
          >
            <Plus className="size-4" />
            Add note
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
