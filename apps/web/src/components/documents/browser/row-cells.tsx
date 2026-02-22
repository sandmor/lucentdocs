import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ChevronRight, FileText, Folder, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toDirectoryDropId, toDragId } from './dnd-utils'
import type { DragData, DropData } from './types'

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

export function DirectoryCell({
  name,
  path,
  isActive,
}: {
  name: string
  path: string
  isActive: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: toDirectoryDropId(path),
    data: { kind: 'directory', path } satisfies DropData,
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors',
        isOver && 'bg-accent text-accent-foreground ring-1 ring-border'
      )}
    >
      <DragHandle dragData={{ kind: 'directory', path }} />
      <Folder className="text-muted-foreground size-4" />
      <span className={isActive ? 'font-medium' : undefined}>{name}</span>
      <ChevronRight className="text-muted-foreground ml-1 size-4" />
    </div>
  )
}

export function DocumentCell({
  id,
  name,
  path,
  isActive,
}: {
  id: string
  name: string
  path: string
  isActive: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-0.5">
      <DragHandle dragData={{ kind: 'document', id, path }} />
      <FileText className="text-muted-foreground size-4" />
      <span className={isActive ? 'font-medium' : undefined}>{name}</span>
    </div>
  )
}
