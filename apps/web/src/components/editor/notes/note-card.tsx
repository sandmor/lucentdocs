import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { MessageSquareText, Minimize2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DocumentNoteViewModel } from './notes-store'
import { NoteEditor, type NoteEditorHandle } from './note-editor'
import { EDITOR_NOTE_CARD_WIDTH } from '../side-elements/layout'

const ORB_SIZE = 40

type EditMode = 'reading' | 'editing'

interface NoteCardProps {
  note: DocumentNoteViewModel
  authorLabel: string
  authorColor: string
  isExpanded: boolean
  /** When true, note enters editing state immediately on expand (e.g. newly created) */
  isNew?: boolean
  onExpand: () => void
  onCollapse: () => void
  onDelete: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

function springTransition(reducedMotion: boolean | null) {
  if (reducedMotion) return { duration: 0 }
  return { type: 'spring' as const, stiffness: 380, damping: 32, mass: 0.8 }
}

function fadeTransition(reducedMotion: boolean | null) {
  if (reducedMotion) return { duration: 0 }
  return { duration: 0.14 }
}

export function NoteCard({
  note,
  authorLabel,
  authorColor,
  isExpanded,
  isNew,
  onExpand,
  onCollapse,
  onDelete,
  onMouseEnter,
  onMouseLeave,
}: NoteCardProps) {
  const shouldReduceMotion = useReducedMotion()
  const [editMode, setEditMode] = useState<EditMode>(isNew ? 'editing' : 'reading')
  const cardRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<NoteEditorHandle>(null)

  const [prevExpanded, setPrevExpanded] = useState(isExpanded)
  if (isExpanded !== prevExpanded) {
    setPrevExpanded(isExpanded)
    if (isExpanded) {
      setEditMode(isNew ? 'editing' : 'reading')
    }
  }

  const isCollapsed = !isExpanded

  useEffect(() => {
    if (isCollapsed) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCollapse()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isCollapsed, onCollapse])

  const handleBodyClick = useCallback(() => {
    if (editMode === 'reading') {
      setEditMode('editing')
      requestAnimationFrame(() => editorRef.current?.focus())
    }
  }, [editMode])

  const handleEditorFocus = useCallback(() => {
    setEditMode('editing')
  }, [])

  const handleEditorBlur = useCallback(() => {
    requestAnimationFrame(() => {
      if (!cardRef.current?.contains(document.activeElement)) {
        setEditMode('reading')
      }
    })
  }, [])

  const spring = springTransition(shouldReduceMotion)
  const fade = fadeTransition(shouldReduceMotion)

  return (
    <motion.div
      ref={cardRef}
      animate={{
        width: isCollapsed ? ORB_SIZE : EDITOR_NOTE_CARD_WIDTH,
        height: isCollapsed ? ORB_SIZE : 'auto',
        borderRadius: isCollapsed ? 50 : 8,
      }}
      initial={false}
      transition={spring}
      style={{ overflow: 'hidden', position: 'relative' }}
      className={cn(
        'pointer-events-auto',
        isCollapsed
          ? 'cursor-pointer border border-border bg-background/95 shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur-md hover:bg-muted/50 dark:shadow-black/40 dark:ring-white/10'
          : 'note-card border border-border/70 bg-card/95 shadow-sm backdrop-blur-sm'
      )}
      onClick={isCollapsed ? onExpand : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Card body stays mounted so height: auto is measured during morph */}
      <motion.div
        animate={{ opacity: isCollapsed ? 0 : 1 }}
        transition={fade}
        style={{ pointerEvents: isCollapsed ? 'none' : 'auto' }}
        className="p-3"
        aria-hidden={isCollapsed}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: authorColor }}
            />
            <span className="truncate text-xs font-medium text-foreground/80">{authorLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Minimize note"
              aria-label="Minimize note"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                onCollapse()
              }}
            >
              <Minimize2 className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Delete note"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>

        <div
          className={cn(
            'overflow-y-auto',
            editMode === 'reading' ? 'max-h-none min-h-0 cursor-text' : 'max-h-[55vh] min-h-16'
          )}
          onClick={handleBodyClick}
        >
          <NoteEditor
            ref={editorRef}
            body={note.body}
            yMap={note.yMap}
            editable={editMode === 'editing'}
            onFocus={handleEditorFocus}
            onBlur={handleEditorBlur}
          />
        </div>

        {editMode === 'reading' && (
          <div className="pointer-events-none mt-1 select-none text-right text-[10px] text-muted-foreground/40">
            click to edit
          </div>
        )}
      </motion.div>

      {/* Orb glyph overlay — visible when collapsed */}
      <motion.div
        animate={{ opacity: isCollapsed ? 1 : 0 }}
        transition={fade}
        className="absolute inset-0 flex items-center justify-center"
        style={{ pointerEvents: 'none' }}
        aria-hidden={!isCollapsed}
      >
        <MessageSquareText className="size-4 text-muted-foreground" />
      </motion.div>
    </motion.div>
  )
}
