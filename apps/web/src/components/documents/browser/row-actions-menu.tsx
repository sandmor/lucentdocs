import { ArrowRightLeft, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { BrowserRow } from './types'

interface RowActionsMenuProps {
  item: BrowserRow
  onRenameDocument: (documentId: string) => void
  onMoveDocument: (documentId: string) => void
  onDeleteDocument: (documentId: string) => void
  onRenameDirectory: (path: string) => void
  onMoveDirectory: (path: string) => void
  onDeleteDirectory: (path: string) => void
}

export function RowActionsMenu({
  item,
  onRenameDocument,
  onMoveDocument,
  onDeleteDocument,
  onRenameDirectory,
  onMoveDirectory,
  onDeleteDirectory,
}: RowActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
            <span className="sr-only">Open actions</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-auto">
        {item.type === 'document' ? (
          <>
            <DropdownMenuItem onClick={() => onRenameDocument(item.id)}>
              <Pencil className="size-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMoveDocument(item.id)}>
              <ArrowRightLeft className="size-4" />
              Move
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDeleteDocument(item.id)}>
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onClick={() => onRenameDirectory(item.path)}>
              <Pencil className="size-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMoveDirectory(item.path)}>
              <ArrowRightLeft className="size-4" />
              Move
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDeleteDirectory(item.path)}>
              <Trash2 className="size-4" />
              Delete directory
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
