import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ChevronRight, FileText, Folder, GripVertical } from 'lucide-react'
import { Fragment, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { toDirectoryDropId, toDragId } from './dnd-utils'
import { buildHighlightPattern } from './highlight-utils'
import { formatRelativeDate } from './path-utils'
import { RowActionsMenu } from './row-actions-menu'
import type { BrowserRow, DragData, DropData } from './types'

export function HighlightedSnippet({ text, query }: { text: string; query: string }) {
  const pattern = buildHighlightPattern(query)
  if (!pattern) return <span>{text}</span>

  const parts = text.split(pattern)
  return (
    <span>
      {parts.map((part, index) => {
        const isMatch = pattern.test(part)
        pattern.lastIndex = 0
        return isMatch ? (
          <mark key={`${part}-${index}`} className="bg-primary/15 text-foreground rounded px-0.5">
            {part}
          </mark>
        ) : (
          <Fragment key={`${part}-${index}`}>{part}</Fragment>
        )
      })}
    </span>
  )
}

function DragHandle({ dragData }: { dragData: DragData }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: toDragId(dragData),
    data: dragData,
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={cn(
        'text-muted-foreground hover:text-foreground inline-flex size-5 items-center justify-center rounded-md',
        isDragging && 'opacity-40'
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label="Drag to move"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" />
    </button>
  )
}

// --- Full-bleed row used by the new DocumentList ---

function handleRowKeyActivate(event: KeyboardEvent<HTMLDivElement>, onClick: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onClick()
  }
}

interface DocumentListRowProps {
  row: BrowserRow
  isActive: boolean
  onClick: () => void
  onRenameDocument: (documentId: string) => void
  onMoveDocument: (documentId: string) => void
  onSettingsDocument: (documentId: string) => void
  onDeleteDocument: (documentId: string) => void
  onExportDocument: (documentId: string) => void
  onRenameDirectory: (path: string) => void
  onMoveDirectory: (path: string) => void
  onDeleteDirectory: (path: string) => void
}

function DirectoryListRow({
  row,
  isActive,
  onClick,
  ...actionProps
}: DocumentListRowProps & { row: BrowserRow & { type: 'directory' } }) {
  const { setNodeRef, isOver } = useDroppable({
    id: toDirectoryDropId(row.path),
    data: { kind: 'directory', path: row.path } satisfies DropData,
  })

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => handleRowKeyActivate(event, onClick)}
      className={cn(
        'group flex h-9 cursor-pointer items-center gap-2 px-3 transition-colors',
        'hover:bg-muted/50',
        isActive && 'bg-accent/50',
        isOver && 'bg-accent text-accent-foreground ring-1 ring-border'
      )}
    >
      <DragHandle dragData={{ kind: 'directory', path: row.path }} />
      <Folder className="text-muted-foreground size-4 shrink-0" />
      <span className={cn('min-w-0 flex-1 truncate text-sm', isActive && 'font-medium')}>
        {row.name}
      </span>
      <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {formatRelativeDate(row.updatedAt)}
      </span>
      <div
        className="shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <RowActionsMenu
          item={row}
          onRenameDocument={actionProps.onRenameDocument}
          onMoveDocument={actionProps.onMoveDocument}
          onSettingsDocument={actionProps.onSettingsDocument}
          onDeleteDocument={actionProps.onDeleteDocument}
          onExportDocument={actionProps.onExportDocument}
          onRenameDirectory={actionProps.onRenameDirectory}
          onMoveDirectory={actionProps.onMoveDirectory}
          onDeleteDirectory={actionProps.onDeleteDirectory}
        />
      </div>
    </div>
  )
}

function DocumentFileListRow({
  row,
  isActive,
  onClick,
  ...actionProps
}: DocumentListRowProps & { row: BrowserRow & { type: 'document' } }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => handleRowKeyActivate(event, onClick)}
      className={cn(
        'group flex h-9 cursor-pointer items-center gap-2 px-3 transition-colors',
        'hover:bg-muted/50',
        isActive && 'bg-accent/50'
      )}
    >
      <DragHandle dragData={{ kind: 'document', id: row.id, path: row.path }} />
      <FileText className="text-muted-foreground size-4 shrink-0" />
      <span className={cn('min-w-0 flex-1 truncate text-sm', isActive && 'font-medium')}>
        {row.name}
      </span>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {formatRelativeDate(row.updatedAt)}
      </span>
      <div
        className="shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <RowActionsMenu
          item={row}
          onRenameDocument={actionProps.onRenameDocument}
          onMoveDocument={actionProps.onMoveDocument}
          onSettingsDocument={actionProps.onSettingsDocument}
          onDeleteDocument={actionProps.onDeleteDocument}
          onExportDocument={actionProps.onExportDocument}
          onRenameDirectory={actionProps.onRenameDirectory}
          onMoveDirectory={actionProps.onMoveDirectory}
          onDeleteDirectory={actionProps.onDeleteDirectory}
        />
      </div>
    </div>
  )
}

export function DocumentListRow(props: DocumentListRowProps) {
  if (props.row.type === 'directory') {
    return <DirectoryListRow {...props} row={props.row} />
  }
  if (props.row.type === 'document') {
    return <DocumentFileListRow {...props} row={props.row} />
  }
  return null
}
