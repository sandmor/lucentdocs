import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Trash2 } from 'lucide-react'
import type * as Y from 'yjs'
import type { DocumentNoteViewModel } from './notes-store'
import { deleteNoteFromMap } from './notes-store'
import { NoteEditor } from './note-editor'
import { useNoteAuthorLabels } from './use-note-author-labels'

interface NoteSheetProps {
  blockId: string
  notes: DocumentNoteViewModel[]
  notesMap: Y.Map<unknown>
  projectId?: string
  currentUserId: string
  onClose: () => void
}

export function NoteSheet({
  notes,
  notesMap,
  projectId,
  currentUserId,
  onClose,
}: NoteSheetProps) {
  const authorLabels = useNoteAuthorLabels(
    notes.map((note) => note.authorUserId),
    currentUserId,
    projectId
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="top-auto bottom-0 max-h-[70vh] translate-y-0 rounded-b-none sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Notes</DialogTitle>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes for this block.</p>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="rounded-lg border border-border/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: authorLabels.getColor(note.authorUserId) }}
                    />
                    <span className="text-sm font-medium">
                      {authorLabels.getLabel(note.authorUserId)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label="Delete note"
                    onClick={() => deleteNoteFromMap(notesMap, note.id)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <NoteEditor body={note.body} autoFocus={notes[0]?.id === note.id} />
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
